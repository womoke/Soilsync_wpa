from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.services.isda_client import (
    THIRD_PARTY_SOIL_CONSENT_SCOPE,
    IsdaClientError,
    IsdaConsentRequired,
    IsdaIntegrationDisabled,
    IsdaSoilClient,
    normalize_soil_estimate,
    parse_soil_property_response,
)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "isda" / "soilproperty_contract_example.json"
SOIL_CONSENT = {THIRD_PARTY_SOIL_CONSENT_SCOPE}


def _contract_payload() -> dict[str, Any]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_parse_contract_example_and_normalize_value_and_uncertainty() -> None:
    estimate = parse_soil_property_response(_contract_payload(), "nitrogen_total")
    normalized = normalize_soil_estimate(estimate)

    assert estimate.analyte == "total_nitrogen"
    assert estimate.value == 12.5
    assert estimate.source_value_text == "12.5"
    assert estimate.source_unit == "g/kg"
    assert estimate.depth_layer == "0-20"
    assert (estimate.depth_top_cm, estimate.depth_bottom_cm) == (0, 20)
    assert estimate.uncertainty is not None
    assert estimate.uncertainty.interval_level == 90
    assert estimate.uncertainty.lower_bound == 8
    assert estimate.uncertainty.upper_bound == 17
    assert normalized.measurement.quality_status == "estimated"
    assert normalized.measurement.value == 1.25
    assert normalized.measurement.canonical_unit == "%"
    assert normalized.uncertainty_lower == 0.8
    assert normalized.uncertainty_upper == 1.7
    assert normalized.interval_level == 90
    assert normalized.measurement.transformations == [
        "unit_conversion:g/kg->%",
        "depth_layer:0-20",
    ]


def test_null_uncertainty_is_preserved_without_inventing_an_interval() -> None:
    payload = _contract_payload()
    payload["property"]["nitrogen_total"][0]["uncertainty"] = None

    estimate = parse_soil_property_response(payload, "nitrogen_total")
    normalized = normalize_soil_estimate(estimate)

    assert estimate.uncertainty is None
    assert normalized.uncertainty_lower is None
    assert normalized.uncertainty_upper is None
    assert normalized.interval_level is None


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda row: row["value"].update(value="not a number"), "value.value"),
        (
            lambda row: row["value"].update(unit=""),
            "missing a usable value unit",
        ),
        (
            lambda row: row["uncertainty"].update(confidence_interval="ninety"),
            "confidence_interval",
        ),
        (
            lambda row: row["uncertainty"].update(lower_bound="18", upper_bound="8"),
            "lower_bound cannot exceed upper_bound",
        ),
    ],
)
def test_parser_rejects_malformed_contract_values(mutate, message: str) -> None:
    payload = _contract_payload()
    mutate(payload["property"]["nitrogen_total"][0])

    with pytest.raises(IsdaClientError, match=message):
        parse_soil_property_response(payload, "nitrogen_total")


def test_parser_rejects_multiple_confidence_intervals_instead_of_selecting_one() -> None:
    payload = _contract_payload()
    uncertainty = payload["property"]["nitrogen_total"][0]["uncertainty"]
    payload["property"]["nitrogen_total"][0]["uncertainty"] = [uncertainty, uncertainty]

    with pytest.raises(IsdaClientError, match="multiple confidence intervals"):
        parse_soil_property_response(payload, "nitrogen_total")


def test_parser_rejects_missing_property_and_unsupported_property_name() -> None:
    with pytest.raises(IsdaClientError, match="exactly one"):
        parse_soil_property_response({"property": {}}, "nitrogen_total")
    with pytest.raises(IsdaClientError, match="Unsupported iSDA soil property"):
        parse_soil_property_response(_contract_payload(), "aluminium_extractable")


def test_disabled_client_makes_no_network_request() -> None:
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        assert request.url.host == "api.isda-africa.com"
        request_count += 1
        return httpx.Response(200, json={"property": {}})

    async def exercise() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = IsdaSoilClient(http_client, username="u", password="p")
            with pytest.raises(IsdaIntegrationDisabled):
                await client.get_soil_property(
                    latitude=-1,
                    longitude=36,
                    depth="0-20",
                    property_name="nitrogen_total",
                    consent_scopes=SOIL_CONSENT,
                )
            with pytest.raises(IsdaIntegrationDisabled):
                await client.get_layers()

    asyncio.run(exercise())
    assert request_count == 0


def test_client_requires_third_party_scope_before_network_request() -> None:
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        assert request.url.host == "api.isda-africa.com"
        request_count += 1
        return httpx.Response(200, json={"access_token": "token", "token_type": "bearer"})

    async def exercise() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = IsdaSoilClient(http_client, username="u", password="p", enabled=True)
            with pytest.raises(IsdaConsentRequired):
                await client.get_soil_property(
                    latitude=-1,
                    longitude=36,
                    depth="0-20",
                    property_name="nitrogen_total",
                )

    asyncio.run(exercise())
    assert request_count == 0


def test_client_authenticates_caches_token_and_uses_v2_query_names() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/isdasoil/v2/login":
            return httpx.Response(
                200,
                json={"access_token": "fixture-token", "token_type": "bearer"},
            )
        if request.url.path == "/isdasoil/v2/soilproperty":
            return httpx.Response(200, json=_contract_payload())
        raise AssertionError(f"Unexpected endpoint: {request.url.path}")

    async def exercise() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = IsdaSoilClient(
                http_client,
                username="service@example.test",
                password="fixture-password",
                enabled=True,
                minimum_request_interval_seconds=0,
                backoff_seconds=0,
            )
            for _ in range(2):
                result = await client.get_soil_property(
                    latitude=-1.25,
                    longitude=36.75,
                    depth="0-20",
                    property_name="nitrogen_total",
                    consent_scopes=SOIL_CONSENT,
                )
                assert result.value == 12.5

    asyncio.run(exercise())

    login_requests = [request for request in requests if request.url.path.endswith("/login")]
    soil_requests = [
        request for request in requests if request.url.path.endswith("/soilproperty")
    ]
    assert len(login_requests) == 1
    assert len(soil_requests) == 2
    assert login_requests[0].headers["content-type"].startswith(
        "application/x-www-form-urlencoded"
    )
    for request in soil_requests:
        assert request.headers["authorization"] == "Bearer fixture-token"
        assert request.url.params["lat"] == "-1.25"
        assert request.url.params["lon"] == "36.75"
        assert request.url.params["depth"] == "0-20"
        assert request.url.params["property"] == "nitrogen_total"


def test_client_refreshes_token_once_after_unauthorized_response() -> None:
    login_count = 0
    soil_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal login_count, soil_count
        if request.url.path.endswith("/login"):
            login_count += 1
            return httpx.Response(
                200,
                json={"access_token": f"fixture-token-{login_count}", "token_type": "bearer"},
            )
        soil_count += 1
        if soil_count == 1:
            return httpx.Response(401, json={"detail": "expired"})
        return httpx.Response(200, json=_contract_payload())

    async def exercise() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = IsdaSoilClient(
                http_client,
                username="service@example.test",
                password="fixture-password",
                enabled=True,
                backoff_seconds=0,
            )
            result = await client.get_soil_property(
                latitude=-1.25,
                longitude=36.75,
                depth="0-20",
                property_name="nitrogen_total",
                consent_scopes=SOIL_CONSENT,
            )
            assert result.value == 12.5

    asyncio.run(exercise())
    assert login_count == 2
    assert soil_count == 2


def test_client_retries_retryable_http_status_with_a_bounded_attempt_count() -> None:
    login_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal login_count
        if request.url.path.endswith("/login"):
            login_count += 1
            if login_count == 1:
                return httpx.Response(503)
            return httpx.Response(
                200,
                json={"access_token": "fixture-token", "token_type": "bearer"},
            )
        return httpx.Response(200, json=_contract_payload())

    async def exercise() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            client = IsdaSoilClient(
                http_client,
                username="service@example.test",
                password="fixture-password",
                enabled=True,
                max_attempts=2,
                backoff_seconds=0,
            )
            await client.get_soil_property(
                latitude=-1.25,
                longitude=36.75,
                depth="0-20",
                property_name="nitrogen_total",
                consent_scopes=SOIL_CONSENT,
            )

    asyncio.run(exercise())
    assert login_count == 2


def test_client_rejects_coordinates_on_the_api_exclusive_bounds() -> None:
    async def exercise() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"request": request.url.path})
            )
        ) as client:
            isda_client = IsdaSoilClient(
                client,
                username="u",
                password="p",
                enabled=True,
            )
            with pytest.raises(ValueError, match="strictly between -90 and 90"):
                await isda_client.get_soil_property(
                    latitude=90,
                    longitude=36,
                    depth="0-20",
                    property_name="nitrogen_total",
                    consent_scopes=SOIL_CONSENT,
                )

    asyncio.run(exercise())
