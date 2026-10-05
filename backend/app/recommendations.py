import csv
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.models import SoilReading, SoilRecommendation

REAL_DATA_PATH = Path(__file__).resolve().parents[2] / "soil_data_all.csv"

# ---------------------------------------------------------------------------
# Priority Kenyan Crop Agronomic Standards (KALRO Guidelines)
# ---------------------------------------------------------------------------

CROP_AGRONOMIC_PROFILES: dict[str, dict[str, Any]] = {
    "maize": {
        "name": "Maize (Zea mays)",
        "target_ph_min": 5.8,
        "target_ph_max": 6.5,
        "critical_ph": 5.5,
        "target_nitrogen_pct": 0.15,
        "target_olsen_p_ppm": 20.0,
        "target_k_cmol": 0.30,
        "target_soc_pct": 2.0,
        "basal_p_req_kg_ha": 50.0,  # P2O5
        "starter_n_req_kg_ha": 20.0,
        "topdress_n_req_kg_ha": 60.0,  # At knee-high (V6)
        "k_req_kg_ha": 40.0,
        "manure_deficit_t_ha": 4.0,
    },
    "potatoes": {
        "name": "Irish Potato (Solanum tuberosum)",
        "target_ph_min": 5.0,
        "target_ph_max": 5.8,
        "critical_ph": 4.8,  # Tolerates moderate acidity; pH > 6.0 triggers Streptomyces scabies
        "target_nitrogen_pct": 0.18,
        "target_olsen_p_ppm": 30.0,
        "target_k_cmol": 0.45,
        "target_soc_pct": 2.2,
        "basal_p_req_kg_ha": 80.0,
        "starter_n_req_kg_ha": 40.0,
        "topdress_n_req_kg_ha": 60.0,  # At hilling/tuber initiation
        "k_req_kg_ha": 90.0,  # High K requirement for tuber bulking
        "manure_deficit_t_ha": 5.0,
    },
    "tea": {
        "name": "Tea (Camellia sinensis)",
        "target_ph_min": 4.5,
        "target_ph_max": 5.5,
        "critical_ph": 4.0,  # Highly acidophilic
        "target_nitrogen_pct": 0.20,
        "target_olsen_p_ppm": 15.0,
        "target_k_cmol": 0.35,
        "target_soc_pct": 2.5,
        "basal_p_req_kg_ha": 30.0,
        "starter_n_req_kg_ha": 50.0,
        "topdress_n_req_kg_ha": 80.0,
        "k_req_kg_ha": 40.0,
        "manure_deficit_t_ha": 3.0,
    },
    "coffee": {
        "name": "Arabica Coffee (Coffea arabica)",
        "target_ph_min": 5.3,
        "target_ph_max": 6.0,
        "critical_ph": 5.0,
        "target_nitrogen_pct": 0.18,
        "target_olsen_p_ppm": 20.0,
        "target_k_cmol": 0.40,
        "target_soc_pct": 2.2,
        "basal_p_req_kg_ha": 40.0,
        "starter_n_req_kg_ha": 40.0,
        "topdress_n_req_kg_ha": 60.0,
        "k_req_kg_ha": 70.0,
        "manure_deficit_t_ha": 5.0,
    },
    "beans": {
        "name": "Common Beans & Legumes (Phaseolus vulgaris)",
        "target_ph_min": 6.0,
        "target_ph_max": 6.8,
        "critical_ph": 5.8,  # Acid soil suppresses Rhizobia nodulation
        "target_nitrogen_pct": 0.12,
        "target_olsen_p_ppm": 25.0,
        "target_k_cmol": 0.28,
        "target_soc_pct": 1.8,
        "basal_p_req_kg_ha": 45.0,
        "starter_n_req_kg_ha": 15.0,  # Starter N only, biological N-fixation handles rest
        "topdress_n_req_kg_ha": 0.0,
        "k_req_kg_ha": 25.0,
        "manure_deficit_t_ha": 3.0,
    },
    "vegetables": {
        "name": "Brassicas & Leafy Vegetables (Sukuma / Cabbage)",
        "target_ph_min": 6.0,
        "target_ph_max": 6.8,
        "critical_ph": 5.8,  # Risk of Plasmodiophora brassicae (clubroot) in acidic soils
        "target_nitrogen_pct": 0.20,
        "target_olsen_p_ppm": 30.0,
        "target_k_cmol": 0.40,
        "target_soc_pct": 2.2,
        "basal_p_req_kg_ha": 60.0,
        "starter_n_req_kg_ha": 40.0,
        "topdress_n_req_kg_ha": 80.0,  # Split topdress every 3 weeks
        "k_req_kg_ha": 50.0,
        "manure_deficit_t_ha": 5.0,
    },
}

# ---------------------------------------------------------------------------
# Agro-Ecological Zones & Regional Soil Characteristics
# ---------------------------------------------------------------------------

COUNTY_AEZ_FACTORS: dict[str, dict[str, Any]] = {
    # Central Highlands & Upper Rift Valley (Humic Nitisols / Andosols, high buffering, volcanic)
    "nyeri": {"zone": "Central Highlands - High Altitude Volcanic", "buffer_factor": 2.2, "p_fixation": "high"},
    "kiambu": {"zone": "Central Highlands - Volcanic Nitisols", "buffer_factor": 2.0, "p_fixation": "high"},
    "murang'a": {"zone": "Central Highlands - Volcanic Nitisols", "buffer_factor": 2.1, "p_fixation": "high"},
    "embu": {"zone": "Mount Kenya Windward - Humic Nitisols", "buffer_factor": 2.0, "p_fixation": "high"},
    "meru": {"zone": "Mount Kenya North - Volcanic Andosols", "buffer_factor": 2.1, "p_fixation": "high"},
    "kirinyaga": {"zone": "Mount Kenya South - Volcanic Foothills", "buffer_factor": 2.0, "p_fixation": "moderate"},
    "nakuru": {"zone": "Central Rift Valley - Mollic Andosols", "buffer_factor": 1.9, "p_fixation": "moderate"},
    "uasin gishu": {"zone": "North Rift Plateau - Ferralsols/Acrisols", "buffer_factor": 1.9, "p_fixation": "moderate"},
    "kericho": {"zone": "South Rift Highlands - High Rainfall Nitisols", "buffer_factor": 2.3, "p_fixation": "high"},
    # Western Kenya & Lake Victoria Basin (Acidic Acrisols/Ferralsols, weathered)
    "kakamega": {"zone": "Western Rainforest Fringe - Weathered Ferralsols", "buffer_factor": 1.8, "p_fixation": "high"},
    "bungoma": {"zone": "Mount Elgon Slopes - Acidic Acrisols", "buffer_factor": 1.9, "p_fixation": "high"},
    "vihiga": {"zone": "Western Highlands - Intensely Cultivated Nitisols", "buffer_factor": 1.9, "p_fixation": "high"},
    "kisii": {"zone": "Lake Basin Highlands - Heavy Volcanic Loam", "buffer_factor": 2.1, "p_fixation": "moderate"},
    "trans nzoia": {"zone": "Mount Elgon Foothills - Fertile Loams", "buffer_factor": 1.9, "p_fixation": "moderate"},
    # Eastern Semi-Arid & Lowlands (Sandy Clay Loams, lower buffering, low SOC)
    "machakos": {"zone": "Eastern Lower Midlands - Sandy Clay Loam", "buffer_factor": 1.3, "p_fixation": "low"},
    "makueni": {"zone": "Southern Semi-Arid - Chromic Luvisols", "buffer_factor": 1.2, "p_fixation": "low"},
    "kitui": {"zone": "Eastern Drylands - Low Buffering Arenosols", "buffer_factor": 1.1, "p_fixation": "low"},
    # Coast & Coastal Strip (Sandy Ferralsols)
    "kilifi": {"zone": "Coastal Lowlands - Sandy Arenosols", "buffer_factor": 1.0, "p_fixation": "low"},
    "kwale": {"zone": "South Coast - Coastal Ferralsols", "buffer_factor": 1.1, "p_fixation": "low"},
}

DEFAULT_AEZ = {"zone": "General Kenyan Midland Agro-Ecological Zone", "buffer_factor": 1.7, "p_fixation": "moderate"}


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    cleaned = str(value).strip().replace(",", "")
    if cleaned in {"", "NA", "N/A", "nan", "NaN"}:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


@lru_cache(maxsize=1)
def _generate_real_data_benchmarks() -> dict[str, float]:
    benchmarks = {
        "soil_ph": 6.2,
        "total_nitrogen": 0.12,
        "organic_carbon": 1.5,
        "olsen_phosphorus": 18.0,
        "exchangeable_potassium": 0.32,
    }
    if not REAL_DATA_PATH.exists():
        return benchmarks

    series: dict[str, list[float]] = {
        "soil_ph": [],
        "total_nitrogen": [],
        "organic_carbon": [],
        "olsen_phosphorus": [],
        "exchangeable_potassium": [],
    }

    with REAL_DATA_PATH.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            for metric_name, csv_name in {
                "soil_ph": "soil_pH",
                "total_nitrogen": "total_Nitrogen_percent_",
                "organic_carbon": "total_Org_Carbon_percent_",
                "olsen_phosphorus": "phosphorus_Olsen_ppm",
                "exchangeable_potassium": "potassium_meq_percent_",
            }.items():
                value = _safe_float(row.get(csv_name))
                if value is not None:
                    series[metric_name].append(value)

    for metric_name, values in series.items():
        if values:
            values.sort()
            midpoint = len(values) // 2
            lower_quartile = values[max(0, midpoint // 2)]
            benchmarks[metric_name] = max(lower_quartile, benchmarks[metric_name])

    return benchmarks


def _measurement_map(reading: SoilReading) -> dict[str, float | None]:
    values: dict[str, float | None] = {}
    for measurement in reading.measurements:
        values[measurement.analyte] = measurement.value
    return values


def generate_demo_recommendations(reading: SoilReading) -> list[SoilRecommendation]:
    """Backward-compatible prototype generator for demo endpoints."""
    metrics = _measurement_map(reading)
    benchmarks = _generate_real_data_benchmarks()
    recommendations: list[SoilRecommendation] = []
    rules = [
        ("soil_ph", "pH management review", "The demo soil pH is below benchmark.", 0.5, "pH units", "Raise pH with liming."),
        ("total_nitrogen", "Nitrogen management review", "Total nitrogen is below benchmark.", 40.0, "kg/ha", "Apply nitrogen in split."),
        ("organic_carbon", "Organic matter improvement", "Organic carbon is below benchmark.", 2.0, "t/ha", "Apply compost."),
        ("olsen_phosphorus", "Phosphorus supplementation check", "Available phosphorus is low.", 25.0, "kg/ha", "Apply phosphorus."),
        ("exchangeable_potassium", "Potassium balance review", "Potassium is below benchmark.", 30.0, "kg/ha", "Check potassium removal."),
    ]
    for metric_name, title, rationale, rate, unit, follow_up in rules:
        value = metrics.get(metric_name)
        if value is None:
            continue
        benchmark = benchmarks.get(metric_name, 0.0)
        if value < benchmark:
            recommendations.append(
                SoilRecommendation(
                    recommendation_id=f"proto-{metric_name}",
                    farm_id=None,
                    crop="maize",
                    title=title,
                    rationale=f"{rationale} {follow_up}",
                    application_rate=rate,
                    application_unit=unit,
                    rule_version="prototype-v1",
                    review_status="pending_review",
                )
            )
    if not recommendations:
        recommendations.append(
            SoilRecommendation(
                recommendation_id="proto-no-action",
                farm_id=None,
                crop="maize",
                title="Optimal Soil Status",
                rationale="Measurements are within acceptable agronomic limits.",
                application_rate=None,
                application_unit=None,
                rule_version="prototype-v1",
                review_status="pending_review",
            )
        )
    return recommendations[:4]


# ---------------------------------------------------------------------------
# Comprehensive KALRO Agronomic Recommendation Engine (V5 Specification)
# ---------------------------------------------------------------------------

def generate_agronomic_assessment(
    soil_values: dict[str, float | None],
    crop: str = "maize",
    county: str = "Nyeri",
    sub_county: str | None = None,
    ward: str | None = None,
    size_acres: float | None = 1.0,
    field_notes: str | None = None,
) -> dict[str, Any]:
    """
    Executes the deterministic KALRO agronomic recommendation engine.
    Calculates nutrient demand, liming requirements, commercial formulation matches,
    split-application timing, and AI advisory notes scaled to farm acreage.
    """
    crop_key = crop.lower().strip() if crop else "maize"
    profile = CROP_AGRONOMIC_PROFILES.get(crop_key, CROP_AGRONOMIC_PROFILES["maize"])
    county_clean = county.lower().strip() if county else "nyeri"
    aez = COUNTY_AEZ_FACTORS.get(county_clean, DEFAULT_AEZ)

    acres = max(0.1, float(size_acres or 1.0))
    ha_conversion = acres * 0.404686  # 1 acre = 0.404686 ha

    # 1. Extract Soil Values
    ph = soil_values.get("soil_ph")
    nitrogen = soil_values.get("total_nitrogen")
    phosphorus = soil_values.get("olsen_phosphorus")
    potassium = soil_values.get("exchangeable_potassium")
    soc = soil_values.get("organic_carbon")

    diagnoses: list[dict[str, Any]] = []
    prescriptions: list[dict[str, Any]] = []
    commercial_matches: list[dict[str, Any]] = []
    split_schedule: list[dict[str, Any]] = []
    ai_advisory: list[str] = []

    # -----------------------------------------------------------------------
    # 2. Soil pH & Liming Calibration
    # -----------------------------------------------------------------------
    lime_req_t_ha = 0.0
    if ph is not None:
        target_ph_min = profile["target_ph_min"]
        target_ph_max = profile["target_ph_max"]
        critical_ph = profile["critical_ph"]

        if ph < critical_ph:
            status = "severely_acidic"
            deficit = target_ph_min - ph
            # Liming formula: t/ha = deficit * buffer_factor (calibrated to soil texture & AEZ)
            lime_req_t_ha = round(min(5.0, deficit * aez["buffer_factor"]), 2)
            diagnoses.append({
                "analyte": "soil_ph",
                "value": ph,
                "targetRange": f"{target_ph_min} - {target_ph_max}",
                "status": "critical_deficiency",
                "interpretation": f"Soil pH {ph:.2f} is severely acidic for {profile['name']}. Aluminum/Iron toxicity and severe Phosphorus fixation are active.",
            })
            lime_total_farm_t = round(lime_req_t_ha * ha_conversion, 2)
            lime_bags_50kg = int(round((lime_total_farm_t * 1000) / 50))
            prescriptions.append({
                "category": "liming",
                "productType": "Agricultural Lime (CaCO3, 85%+ CCE)",
                "ratePerHa": f"{lime_req_t_ha} t/ha",
                "ratePerAcre": f"{round(lime_req_t_ha * 0.404686, 2)} t/acre ({int(round(lime_req_t_ha * 0.404686 * 1000 / 50))} bags/acre)",
                "totalFarmPrescription": f"{lime_total_farm_t} tonnes ({lime_bags_50kg} x 50kg bags)",
                "applicationTiming": "Broadcast 4-6 weeks before planting; incorporate thoroughly into top 15-20cm.",
            })
            commercial_matches.append({
                "category": "Soil Amendment",
                "commercialFormulation": "Agricultural Lime / Dolomitic Lime (CaCO3 + MgCO3)",
                "purpose": "Neutralize soil acidity, supply calcium/magnesium, and unlock fixed phosphorus.",
                "totalBagsNeeded": lime_bags_50kg,
                "bagUnit": "50kg bag",
            })
            split_schedule.append({
                "stage": "Pre-Planting (4 weeks prior)",
                "action": f"Broadcast {lime_bags_50kg} bags of Agricultural Lime across {acres} acres and plough in.",
                "notes": "Do not apply lime simultaneously with nitrogenous fertilizers to avoid ammonia gas volatilization.",
            })
            ai_advisory.append(
                f"Acidity Alert: Soil pH {ph:.1f} severely inhibits fertilizer use efficiency. Without liming, up to 60% of applied basal phosphorus will remain chemically locked in the soil."
            )
        elif ph < target_ph_min:
            diagnoses.append({
                "analyte": "soil_ph",
                "value": ph,
                "targetRange": f"{target_ph_min} - {target_ph_max}",
                "status": "moderately_acidic",
                "interpretation": f"Soil pH {ph:.2f} is slightly below optimum. Mild nutrient lock-up possible.",
            })
            ai_advisory.append(f"Maintain soil organic matter and avoid acidifying fertilizers like Ammonium Sulphate.")
        elif ph > target_ph_max:
            diagnoses.append({
                "analyte": "soil_ph",
                "value": ph,
                "targetRange": f"{target_ph_min} - {target_ph_max}",
                "status": "alkaline",
                "interpretation": f"Soil pH {ph:.2f} is higher than optimal for {profile['name']}.",
            })
        else:
            diagnoses.append({
                "analyte": "soil_ph",
                "value": ph,
                "targetRange": f"{target_ph_min} - {target_ph_max}",
                "status": "optimal",
                "interpretation": f"Soil pH {ph:.2f} is in the ideal range for nutrient bioavailability.",
            })

    # -----------------------------------------------------------------------
    # 3. Available Phosphorus (P, Olsen) & Basal Fertilizer Placement
    # -----------------------------------------------------------------------
    if phosphorus is not None:
        target_p = profile["target_olsen_p_ppm"]
        if phosphorus < target_p:
            p_deficit_ratio = max(0.2, (target_p - phosphorus) / target_p)
            base_p2o5_kg_ha = profile["basal_p_req_kg_ha"] * (1.0 + 0.3 * p_deficit_ratio)
            # Commercial DAP formulation: 46% P2O5, 18% N
            dap_kg_ha = round(base_p2o5_kg_ha / 0.46, 1)
            dap_kg_acre = round(dap_kg_ha * 0.404686, 1)
            total_dap_kg = round(dap_kg_acre * acres, 1)
            dap_bags_50kg = max(1, int(round(total_dap_kg / 50)))

            diagnoses.append({
                "analyte": "olsen_phosphorus",
                "value": phosphorus,
                "targetRange": f">= {target_p} mg/kg",
                "status": "deficient",
                "interpretation": f"Available Phosphorus ({phosphorus:.1f} mg/kg) is deficient for root establishment.",
            })
            prescriptions.append({
                "category": "basal_fertilizer",
                "productType": "DAP (18-46-0) or NPK 23:23:0",
                "ratePerHa": f"{dap_kg_ha} kg/ha",
                "ratePerAcre": f"{dap_kg_acre} kg/acre ({round(dap_kg_acre/50, 1)} bags/acre)",
                "totalFarmPrescription": f"{total_dap_kg} kg ({dap_bags_50kg} x 50kg bags)",
                "applicationTiming": "At planting in the furrow/hole; place 5 cm to side and 5 cm below seed.",
            })
            commercial_matches.append({
                "category": "Basal Planting Fertilizer",
                "commercialFormulation": "DAP (18-46-0) / NPK 23:23:0 / TSP (0-46-0)",
                "purpose": "Promote vigorous seedling root development and early canopy establishment.",
                "totalBagsNeeded": dap_bags_50kg,
                "bagUnit": "50kg bag",
            })
            split_schedule.append({
                "stage": "Planting Time",
                "action": f"Apply {total_dap_kg} kg of DAP (approx {dap_bags_50kg} bags) as basal fertilizer.",
                "notes": "Always mix fertilizer with soil before dropping the seed to prevent seedling chemical burn.",
            })
        else:
            diagnoses.append({
                "analyte": "olsen_phosphorus",
                "value": phosphorus,
                "targetRange": f">= {target_p} mg/kg",
                "status": "optimal",
                "interpretation": f"Available Phosphorus ({phosphorus:.1f} mg/kg) is adequate. Maintenance rate only.",
            })

    # -----------------------------------------------------------------------
    # 4. Total Nitrogen (N) & Top-Dressing Split Schedule
    # -----------------------------------------------------------------------
    if nitrogen is not None:
        target_n = profile["target_nitrogen_pct"]
        topdress_req_kg_ha = profile["topdress_n_req_kg_ha"]
        if topdress_req_kg_ha > 0:
            # Top dressing formulation: CAN (26% N)
            can_kg_ha = round(topdress_req_kg_ha / 0.26, 1)
            can_kg_acre = round(can_kg_ha * 0.404686, 1)
            total_can_kg = round(can_kg_acre * acres, 1)
            can_bags_50kg = max(1, int(round(total_can_kg / 50)))

            diagnoses.append({
                "analyte": "total_nitrogen",
                "value": nitrogen,
                "targetRange": f">= {target_n}%",
                "status": "deficient" if nitrogen < target_n else "optimal",
                "interpretation": f"Total Nitrogen ({nitrogen:.2f}%) requires scheduled top-dressing for vegetative growth.",
            })
            prescriptions.append({
                "category": "topdressing",
                "productType": "CAN (Calcium Ammonium Nitrate 26% N)",
                "ratePerHa": f"{can_kg_ha} kg/ha",
                "ratePerAcre": f"{can_kg_acre} kg/acre ({round(can_kg_acre/50, 1)} bags/acre)",
                "totalFarmPrescription": f"{total_can_kg} kg ({can_bags_50kg} x 50kg bags)",
                "applicationTiming": "Split top-dress when crop is knee-high (4-6 weeks post-emergence) in moist soil.",
            })
            commercial_matches.append({
                "category": "Top-Dressing Fertilizer",
                "commercialFormulation": "CAN (26% N) / Urea (46% N)",
                "purpose": "Sustain rapid vegetative biomass expansion and photosynthetic leaf area index.",
                "totalBagsNeeded": can_bags_50kg,
                "bagUnit": "50kg bag",
            })
            split_schedule.append({
                "stage": "Knee-High (4-6 weeks post-emergence)",
                "action": f"Apply {total_can_kg} kg of CAN (approx {can_bags_50kg} bags) ring-placed around stems.",
                "notes": "Apply when soil is moist; bury or cover with soil during weeding to avoid nitrogen loss.",
            })

    # -----------------------------------------------------------------------
    # 5. Total Organic Carbon (SOC) & Biological Soil Health
    # -----------------------------------------------------------------------
    if soc is not None:
        target_soc = profile["target_soc_pct"]
        if soc < target_soc:
            manure_t_ha = profile["manure_deficit_t_ha"]
            total_manure_t = round(manure_t_ha * ha_conversion, 1)
            diagnoses.append({
                "analyte": "organic_carbon",
                "value": soc,
                "targetRange": f">= {target_soc}%",
                "status": "deficient",
                "interpretation": f"Soil Organic Carbon ({soc:.2f}%) is low. Soil has depleted biological activity and water holding capacity.",
            })
            prescriptions.append({
                "category": "soil_rehabilitation",
                "productType": "Well-Decomposed Farmyard Manure or Organic Compost",
                "ratePerHa": f"{manure_t_ha} t/ha",
                "ratePerAcre": f"{round(manure_t_ha * 0.404686, 1)} t/acre",
                "totalFarmPrescription": f"{total_manure_t} tonnes organic manure",
                "applicationTiming": "Broadcast and incorporate during land preparation 2-3 weeks before planting.",
            })
            commercial_matches.append({
                "category": "Organic Soil Amendment",
                "commercialFormulation": "Organic Compost / Cured Farmyard Manure / Biochar Blend",
                "purpose": "Restore soil microbial ecosystem, enhance moisture retention, and increase Cation Exchange Capacity (CEC).",
                "totalBagsNeeded": int(round(total_manure_t * 20)),  # 50kg bags equivalent
                "bagUnit": "50kg manure bag",
            })
            ai_advisory.append(
                f"Soil Health Recommendation: Incorporate crop residues instead of burning, and plant nitrogen-fixing green manure cover crops (e.g. Desmodium or Mucuna) to rebuild topsoil organic carbon."
            )

    # -----------------------------------------------------------------------
    # 6. Exchangeable Potassium (K)
    # -----------------------------------------------------------------------
    if potassium is not None:
        target_k = profile["target_k_cmol"]
        if potassium < target_k:
            diagnoses.append({
                "analyte": "exchangeable_potassium",
                "value": potassium,
                "targetRange": f">= {target_k} cmol/kg",
                "status": "deficient",
                "interpretation": f"Exchangeable Potassium ({potassium:.2f} cmol/kg) is deficient.",
            })
            prescriptions.append({
                "category": "potassium_supplementation",
                "productType": "Muriate of Potash (MOP 0-0-60) or NPK 17:17:17",
                "ratePerHa": f"{profile['k_req_kg_ha']} kg/ha",
                "ratePerAcre": f"{round(profile['k_req_kg_ha'] * 0.404686, 1)} kg/acre",
                "totalFarmPrescription": f"{round(profile['k_req_kg_ha'] * ha_conversion, 1)} kg",
                "applicationTiming": "Apply basally with planting fertilizer.",
            })

    # AI Climate & Agronomic Advisory Synthesizer
    ai_advisory.append(
        f"Zone Context: {county} ({aez['zone']}). Calibrated for local soil mineralogy and {aez['p_fixation']} phosphorus fixation risk."
    )
    if field_notes:
        ai_advisory.append(f"Field Observation Context: {field_notes}")

    return {
        "engineVersion": "kalro-rules-v2.1",
        "generatedAt": datetime.now(UTC).isoformat(),
        "crop": profile["name"],
        "farmAcreage": acres,
        "county": county,
        "subCounty": sub_county,
        "ward": ward,
        "regionalZone": aez["zone"],
        "bufferFactor": aez["buffer_factor"],
        "diagnoses": diagnoses,
        "prescriptions": prescriptions,
        "commercialInputs": commercial_matches,
        "splitSchedule": split_schedule,
        "aiAdvisoryNotes": ai_advisory,
        "disclaimer": (
            "This automated agronomic assessment is generated by SoilSync's KALRO-calibrated recommendation engine. "
            "It is UNVERIFIED and pending review by a licensed extension agronomist before farm execution."
        ),
    }
