from __future__ import annotations

import asyncio
import math
import re
import time
from collections.abc import Collection, Mapping
from dataclasses import dataclass, replace
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from app.soil.normalize import NormalizedMeasurement, normalize_measurement

ISDA_API_BASE_URL = "https://api.isda-africa.com"
ISDA_LOGIN_PATH = "/isdasoil/v2/login"
ISDA_LAYERS_PATH = "/isdasoil/v2/layers"
ISDA_SOIL_PROPERTY_PATH = "/isdasoil/v2/soilproperty"
THIRD_PARTY_SOIL_CONSENT_SCOPE = "send_coordinates_to_third_party_soil_service"
SUPPORTED_DEPTHS = frozenset({"0-20", "0-50", "20-50", "0-200", "0"})
ISDA_PROPERTY_TO_ANALYTE = {
    "ph": "soil_ph",
    "nitrogen_total": "total_nitrogen",
    "carbon_organic": "organic_carbon",
    "phosphorous_extractable": "extractable_phosphorus",
    "potassium_extractable": "extractable_potassium",
}

_DEPTH_RANGE_PATTERN = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$")
_RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503, 504})


class IsdaClientError(RuntimeError):
    pass


class IsdaIntegrationDisabled(IsdaClientError):
    pass


class IsdaConsentRequired(IsdaClientError):
    pass


@dataclass(frozen=True)
class ParsedUncertainty:
    lower_bound: float | None
    upper_bound: float | None
    interval_level: float | None


@dataclass(frozen=True)
class ParsedSoilEstimate:
    property_name: str
    analyte: str
    value: float
    source_value_text: str
    source_unit: str
    depth_layer: str | None
    depth_top_cm: float | None
    depth_bottom_cm: float | None
    uncertainty: ParsedUncertainty | None


@dataclass(frozen=True)
class NormalizedSoilEstimate:
    property_name: str
    analyte: str
    measurement: NormalizedMeasurement
    uncertainty_lower: float | None
    uncertainty_upper: float | None
    interval_level: float | None
    depth_layer: str | None
    depth_top_cm: float | None
    depth_bottom_cm: float | None


def _finite_decimal(value: Any, field_name: str) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise IsdaClientError(f"iSDA response field {field_name!r} must be a finite number.")
    try:
        number = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise IsdaClientError(
            f"iSDA response field {field_name!r} must be a finite number."
        ) from None
    if not number.is_finite():
        raise IsdaClientError(f"iSDA response field {field_name!r} must be a finite number.")
    return number


def _optional_bound(value: Any, field_name: str) -> float | None:
    if value is None:
        return None
    return float(_finite_decimal(value, field_name))


def _parse_interval_level(value: Any) -> float | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise IsdaClientError("iSDA confidence_interval must be a percentage string or null.")
    text = value.strip()
    if text.endswith("%"):
        text = text[:-1].strip()
    number = _finite_decimal(text, "confidence_interval")
    if number < 0 or number > 100:
        raise IsdaClientError("iSDA confidence_interval must be between 0 and 100 percent.")
    return float(number)


def _parse_uncertainty(value: Any) -> ParsedUncertainty | None:
    if value is None:
        return None
    if isinstance(value, list):
        if not value:
            return None
        if len(value) != 1:
            raise IsdaClientError(
                "iSDA returned multiple confidence intervals; selecting one is not supported."
            )
        value = value[0]
    if not isinstance(value, Mapping):
        raise IsdaClientError("iSDA uncertainty must be an object, a single-item list, or null.")

    lower = _optional_bound(value.get("lower_bound"), "uncertainty.lower_bound")
    upper = _optional_bound(value.get("upper_bound"), "uncertainty.upper_bound")
    level = _parse_interval_level(value.get("confidence_interval"))
    if lower is not None and upper is not None and lower > upper:
        raise IsdaClientError("iSDA uncertainty lower_bound cannot exceed upper_bound.")
    if lower is None and upper is None and level is None:
        return None
    return ParsedUncertainty(lower, upper, level)


def _parse_depth(depth: Any) -> tuple[str | None, float | None, float | None]:
    if depth is None:
        return None, None, None
    if not isinstance(depth, Mapping):
        raise IsdaClientError("iSDA depth must be an object.")

    raw_layer = depth.get("value")
    if raw_layer is None:
        return None, None, None
    layer = str(raw_layer).strip()
    if not layer:
        return None, None, None

    unit = depth.get("unit")
    if not isinstance(unit, str) or unit.strip().lower() not in {"cm", "centimeter", "centimeters"}:
        return layer, None, None

    interval = _DEPTH_RANGE_PATTERN.fullmatch(layer)
    if interval:
        top = float(_finite_decimal(interval.group(1), "depth.value"))
        bottom = float(_finite_decimal(interval.group(2), "depth.value"))
        if top > bottom:
            raise IsdaClientError("iSDA depth top cannot exceed depth bottom.")
        return layer, top, bottom

    if layer.isdecimal():
        point = float(_finite_decimal(layer, "depth.value"))
        return layer, point, point
    return layer, None, None


def parse_soil_property_response(
    payload: Mapping[str, Any],
    property_name: str,
) -> ParsedSoilEstimate:
    """Parse one v2 soilproperty result without guessing at units or confidence intervals."""
    analyte = ISDA_PROPERTY_TO_ANALYTE.get(property_name)
    if analyte is None:
        raise IsdaClientError(f"Unsupported iSDA soil property {property_name!r}.")
    property_map = payload.get("property")
    if not isinstance(property_map, Mapping):
        raise IsdaClientError("iSDA soilproperty response is missing its property object.")
    rows = property_map.get(property_name)
    if not isinstance(rows, list) or len(rows) != 1:
        raise IsdaClientError(
            f"iSDA soilproperty response must contain exactly one {property_name!r} result."
        )
    row = rows[0]
    if not isinstance(row, Mapping):
        raise IsdaClientError("iSDA SoilData result must be an object.")

    source_value = row.get("value")
    if not isinstance(source_value, Mapping):
        raise IsdaClientError("iSDA SoilData result is missing its value object.")
    raw_value = source_value.get("value")
    value = float(_finite_decimal(raw_value, "value.value"))
    source_unit = source_value.get("unit")
    if not isinstance(source_unit, str) or not source_unit.strip():
        raise IsdaClientError("iSDA SoilData result is missing a usable value unit.")

    layer, depth_top, depth_bottom = _parse_depth(row.get("depth"))
    return ParsedSoilEstimate(
        property_name=property_name,
        analyte=analyte,
        value=value,
        source_value_text=str(raw_value),
        source_unit=source_unit.strip(),
        depth_layer=layer,
        depth_top_cm=depth_top,
        depth_bottom_cm=depth_bottom,
        uncertainty=_parse_uncertainty(row.get("uncertainty")),
    )


def normalize_soil_estimate(estimate: ParsedSoilEstimate) -> NormalizedSoilEstimate:
    """Normalize an estimate value and interval through the shared soil unit rules."""
    measurement = normalize_measurement(
        analyte=estimate.analyte,
        value=estimate.value,
        source_unit=estimate.source_unit,
        quality_status="estimated",
        source_value_text=estimate.source_value_text,
    )
    uncertainty = estimate.uncertainty
    lower: float | None = None
    upper: float | None = None
    level: float | None = None

    if measurement.quality_status == "estimated" and uncertainty is not None:
        level = uncertainty.interval_level
        bound_results = (
            (
                uncertainty.lower_bound,
                "uncertainty.lower_bound",
            ),
            (
                uncertainty.upper_bound,
                "uncertainty.upper_bound",
            ),
        )
        normalized_bounds: list[float | None] = []
        for raw_bound, field_name in bound_results:
            if raw_bound is None:
                normalized_bounds.append(None)
                continue
            result = normalize_measurement(
                analyte=estimate.analyte,
                value=raw_bound,
                source_unit=estimate.source_unit,
                quality_status="estimated",
                source_value_text=str(raw_bound),
            )
            if result.quality_status != "estimated" or result.value is None:
                measurement = replace(
                    measurement,
                    value=None,
                    quality_status="invalid_source_value",
                    normalization_error=(
                        f"Could not normalize {field_name} using the returned source unit."
                    ),
                )
                normalized_bounds = [None, None]
                level = None
                break
            normalized_bounds.append(result.value)
        if measurement.quality_status == "estimated":
            lower, upper = normalized_bounds

    transformations = list(measurement.transformations)
    if estimate.depth_layer:
        transformations.append(f"depth_layer:{estimate.depth_layer}")
    measurement = replace(measurement, transformations=transformations)
    return NormalizedSoilEstimate(
        property_name=estimate.property_name,
        analyte=estimate.analyte,
        measurement=measurement,
        uncertainty_lower=lower,
        uncertainty_upper=upper,
        interval_level=level,
        depth_layer=estimate.depth_layer,
        depth_top_cm=estimate.depth_top_cm,
        depth_bottom_cm=estimate.depth_bottom_cm,
    )


class IsdaSoilClient:
    """Explicitly gated async client; no live calls occur unless enabled by a caller."""

    def __init__(
        self,
        http_client: httpx.AsyncClient,
        *,
        username: str | None = None,
        password: str | None = None,
        enabled: bool = False,
        timeout_seconds: float = 10.0,
        max_attempts: int = 3,
        backoff_seconds: float = 0.25,
        minimum_request_interval_seconds: float = 0.0,
        token_refresh_after_seconds: float = 3300.0,
        layers_cache_seconds: float = 21600.0,
    ) -> None:
        if timeout_seconds <= 0 or not math.isfinite(timeout_seconds):
            raise ValueError("timeout_seconds must be a positive finite number.")
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1.")
        if backoff_seconds < 0 or minimum_request_interval_seconds < 0:
            raise ValueError("Retry backoff and request interval cannot be negative.")
        if token_refresh_after_seconds <= 0 or layers_cache_seconds <= 0:
            raise ValueError("Cache durations must be positive.")
        self._http_client = http_client
        self._username = username
        self._password = password
        self._enabled = enabled
        self._timeout_seconds = timeout_seconds
        self._max_attempts = max_attempts
        self._backoff_seconds = backoff_seconds
        self._minimum_request_interval_seconds = minimum_request_interval_seconds
        self._token_refresh_after_seconds = token_refresh_after_seconds
        self._layers_cache_seconds = layers_cache_seconds
        self._access_token: str | None = None
        self._token_issued_at = 0.0
        self._layers_payload: Mapping[str, Any] | None = None
        self._layers_fetched_at = 0.0
        self._token_lock = asyncio.Lock()
        self._request_lock = asyncio.Lock()
        self._last_request_at = 0.0

    async def get_layers(self) -> Mapping[str, Any]:
        self._require_enabled()
        now = time.monotonic()
        if (
            self._layers_payload is not None
            and now - self._layers_fetched_at < self._layers_cache_seconds
        ):
            return self._layers_payload

        response = await self._request("GET", ISDA_LAYERS_PATH)
        payload = self._json_object(response)
        if not isinstance(payload.get("property"), Mapping):
            raise IsdaClientError("iSDA layers response is missing its property metadata.")
        self._layers_payload = payload
        self._layers_fetched_at = time.monotonic()
        return payload

    async def get_soil_property(
        self,
        *,
        latitude: float,
        longitude: float,
        depth: str,
        property_name: str,
        consent_scopes: Collection[str] = (),
    ) -> ParsedSoilEstimate:
        self._require_enabled()
        if THIRD_PARTY_SOIL_CONSENT_SCOPE not in consent_scopes:
            raise IsdaConsentRequired(
                "A recorded third-party soil-service consent scope is required for iSDA requests."
            )
        if not math.isfinite(latitude) or not -90 < latitude < 90:
            raise ValueError("Latitude must be finite and strictly between -90 and 90.")
        if not math.isfinite(longitude) or not -180 < longitude < 180:
            raise ValueError("Longitude must be finite and strictly between -180 and 180.")
        if depth not in SUPPORTED_DEPTHS:
            raise ValueError(f"Unsupported iSDA depth {depth!r}.")
        if property_name not in ISDA_PROPERTY_TO_ANALYTE:
            raise ValueError(f"Unsupported iSDA soil property {property_name!r}.")

        params = {
            "lat": latitude,
            "lon": longitude,
            "depth": depth,
            "property": property_name,
        }
        for auth_attempt in range(2):
            token = await self._get_access_token(force_refresh=auth_attempt > 0)
            response = await self._request(
                "GET",
                ISDA_SOIL_PROPERTY_PATH,
                params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
            if response.status_code == 401 and auth_attempt == 0:
                self._access_token = None
                continue
            self._require_success(response)
            return parse_soil_property_response(self._json_object(response), property_name)
        raise IsdaClientError("iSDA authorization was rejected after refreshing the token.")

    def _require_enabled(self) -> None:
        if not self._enabled:
            raise IsdaIntegrationDisabled(
                "iSDA network requests are disabled until product and consent approval."
            )

    async def _get_access_token(self, *, force_refresh: bool = False) -> str:
        self._require_enabled()
        if not self._username or not self._password:
            raise IsdaClientError("iSDA service-account credentials are not configured.")
        if (
            not force_refresh
            and self._access_token is not None
            and time.monotonic() - self._token_issued_at < self._token_refresh_after_seconds
        ):
            return self._access_token

        async with self._token_lock:
            if (
                not force_refresh
                and self._access_token is not None
                and time.monotonic() - self._token_issued_at < self._token_refresh_after_seconds
            ):
                return self._access_token
            response = await self._request(
                "POST",
                ISDA_LOGIN_PATH,
                data={"username": self._username, "password": self._password},
            )
            self._require_success(response)
            payload = self._json_object(response)
            token = payload.get("access_token")
            if not isinstance(token, str) or not token.strip():
                raise IsdaClientError("iSDA login response did not contain an access token.")
            self._access_token = token
            self._token_issued_at = time.monotonic()
            return token

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        data: Mapping[str, str] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> httpx.Response:
        url = f"{ISDA_API_BASE_URL}{path}"
        for attempt in range(self._max_attempts):
            await self._wait_for_request_slot()
            try:
                response = await self._http_client.request(
                    method,
                    url,
                    params=params,
                    data=data,
                    headers=headers,
                    timeout=self._timeout_seconds,
                )
            except httpx.TransportError:
                if attempt + 1 == self._max_attempts:
                    raise IsdaClientError("iSDA request failed due to a transport error.") from None
                await asyncio.sleep(self._backoff_seconds * (2**attempt))
                continue

            if response.status_code not in _RETRYABLE_STATUS_CODES:
                return response
            if attempt + 1 == self._max_attempts:
                return response
            await asyncio.sleep(self._backoff_seconds * (2**attempt))
        raise IsdaClientError("iSDA request exhausted its bounded retry policy.")

    async def _wait_for_request_slot(self) -> None:
        if self._minimum_request_interval_seconds <= 0:
            return
        async with self._request_lock:
            elapsed = time.monotonic() - self._last_request_at
            delay = self._minimum_request_interval_seconds - elapsed
            if delay > 0:
                await asyncio.sleep(delay)
            self._last_request_at = time.monotonic()

    @staticmethod
    def _require_success(response: httpx.Response) -> None:
        if not response.is_success:
            raise IsdaClientError(f"iSDA request failed with HTTP {response.status_code}.")

    @staticmethod
    def _json_object(response: httpx.Response) -> Mapping[str, Any]:
        try:
            payload = response.json()
        except ValueError:
            raise IsdaClientError("iSDA response was not valid JSON.") from None
        if not isinstance(payload, Mapping):
            raise IsdaClientError("iSDA response JSON must be an object.")
        return payload
