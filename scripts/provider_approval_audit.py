#!/usr/bin/env python3
"""Generate a provider-approval checklist and AI review prompt for SoilSync data sources.

This script helps a human or AI reviewer determine whether a data source is safe for:
- storage and reuse,
- attribution and licensing,
- derivation and export,
- recommendation-engine use,
- production backend persistence.
"""

from __future__ import annotations

import argparse
from textwrap import dedent

PROVIDERS = {
    "PROJECT_SOIL_DATASET": {
        "type": "project-provided local soil dataset",
        "owner": "Supplier attribution intentionally omitted; prototype use is assumed by the project owner",
        "urls": [
            "No public license record has been reliably matched to this exact file",
        ],
        "required_evidence": [
            "Keep the project owner's prototype-use assumption distinct from a public license finding",
            "Document internally any restrictions on production storage, redistribution, and public display",
            "Preserve measurement units, methods, depth labels, and project provenance where available",
            "Separate historical recommendation text from measured treatment or harvest outcomes",
        ],
        "questions": [
            "Which prototype processing uses are covered by the project owner's stated assumption?",
            "What internal documentation is needed before production storage or redistribution?",
            "Which records have compatible methods, units, and depth intervals for each analyte?",
            "Are any labels measured outcomes, or only historical recommendation text?",
        ],
    },
    "ISRIC_WOSIS": {
        "type": "API / source dataset",
        "owner": "ISRIC WoSIS",
        "urls": [
            "https://docs.isric.org/globaldata/wosis/",
            "https://graphql.isric.org/",
        ],
        "required_evidence": [
            "Official WoSIS data access and licensing documentation",
            "Record-level license and attribution; admit only verified CC-BY records to the current pipeline",
            "Any prohibition on resharing derived data or transformed snapshots",
            "Whether the project may store cached or normalized responses in a persistence layer",
            "Do not infer that license restrictions necessarily carry into a trained model",
        ],
        "questions": [
            "Are the selected records approved for local retention and transformation?",
            "Does the provider permit using a subset of eligible records in a soil advisory product?",
            "How must the source be cited in the UI or API responses?",
            "Are license values exactly CC-BY and present for every selected record?",
            "Are methods and depths compatible with the intended comparison cohort?",
        ],
    },
    "ISRIC_SOILGRIDS": {
        "type": "API / geospatial dataset",
        "owner": "ISRIC SoilGrids",
        "urls": [
            "https://docs.isric.org/globaldata/soilgrids/",
            "https://rest.isric.org/",
        ],
        "required_evidence": [
            "Official SoilGrids access documentation and supported product usage",
            "Approved properties, depth intervals, and relevant method mappings",
            "Any restrictions on storing results or using them as model input features",
            "Keep predictions as estimated context/features, not ground-truth labels",
            "Evidence that the project qualifies for the intended use before displaying values to farmers",
        ],
        "questions": [
            "How should estimates be labeled and bounded for the selected spatial/depth scale?",
            "Can the project store soil property predictions and their metadata in the backend?",
            "Which layers and depth intervals are approved for this use case?",
            "Do we need to label the values as estimates or predictions in the UI?",
            "What steps are required before a recommendation can be considered agronomically approved?",
        ],
    },
    "SUPABASE": {
        "type": "future backend persistence",
        "owner": "Project team / Supabase project owner",
        "urls": [
            "Insert Supabase project URL and environment links here",
            "Insert privacy and retention policy for this project here",
        ],
        "required_evidence": [
            "Project ownership and data-retention policy",
            "Authentication and authorization design",
            "Whether real source records are allowed in the database",
            "Backups/restore and access control review",
            "Security review for soil data and farmer records",
        ],
        "questions": [
            "Has the project owner approved the retention model for source data and farmer data?",
            "Is the database meant to store raw, normalized, or only staged records?",
            "What is the access scope for extension officers and farmers?",
            "Are there any legal or policy requirements for farm or soil data storage?",
        ],
    },
}


def render_provider_section(name: str, details: dict[str, object]) -> str:
    required_evidence = "\n".join(f"- {item}" for item in details["required_evidence"])
    questions = "\n".join(f"- {item}" for item in details["questions"])
    urls = "\n".join(f"- {item}" for item in details["urls"])

    return "\n".join(
        [
            f"## {name}",
            "",
            f"- Type: {details['type']}",
            f"- Owner: {details['owner']}",
            "- Source URLs:",
            urls,
            "",
            "### Required evidence",
            required_evidence,
            "",
            "### Questions to answer",
            questions,
        ]
    )


def build_ai_prompt() -> str:
    return dedent(
        """
        Review the public provider terms and source notes below. Do not contact data owners. For the project-provided dataset, assume prototype use is authorized by the project owner, but do not describe that assumption as a public license or identify a supplier.

        1. What is the legal or usage basis for this dataset?
        2. Can we store, process, and transform the data in our backend for this product?
        3. Are there any restrictions on redistribution, export, or derived copies?
        4. Are there any attribution or license requirements we must display?
        5. Is the source safe to use in a farmer-facing recommendation product, or only as a reference data source?
        6. What evidence or internal decisions should be deferred to a future version?
        7. Is the data source approved for the current demo phase, a provisional phase, or production only?

        Return a status for each source in this format:
        - Source: <name>
        - Status: approved | conditional | blocked
        - Missing approval items: <list>
        - Risk notes: <summary>
        - Recommended next action: <decision>

        Treat usefulness as separate from rights. Do not infer permission from access or technical availability. Do not use SoilGrids estimates or historical recommendation text as outcome labels. Exclude WoSIS records without verified CC-BY terms; do not claim that NC restrictions necessarily apply to model outputs. Distinguish observed measurements from estimates, and flag method/depth/unit incompatibility.

        Review the source-specific notes that follow this prompt.
        """
    ).strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a provider approval checklist and AI prompt.")
    parser.add_argument(
        "--output",
        type=str,
        help="Optional path to write the markdown report. Defaults to stdout.",
    )
    args = parser.parse_args()

    provider_sections = "\n\n".join(
        render_provider_section(name, details) for name, details in PROVIDERS.items()
    )

    report = dedent(
        """
        # SoilSync Data Source Approval Audit

        This checklist is intended to guide legal, product, and technical review before using any external or local source in a backend or recommendation workflow.

        ## Approval gate

        The project-provided dataset may be used for prototype development under the project owner's stated assumption; this does not establish production, redistribution, or public-display rights. Before production use, document intended use, applicable terms, attribution, retention, backend access controls, and agronomic review. External providers must meet their own license and provenance requirements before records enter the pipeline.

        ## Current decisions

        - The project-provided soil dataset may inform prototype development under the project owner's stated assumption. This is not a public-license finding or supplier attribution; production restrictions should be documented internally.
        - The supplied public-terms review verified CC BY 4.0 for SoilGrids v2.0 maps. Implement ISRIC attribution and preserve estimated status; SoilGrids is not a ground-truth outcome label.
        - The current WoSIS pipeline admits only records with verified CC-BY terms. CC-BY-NC and unknown-license records are excluded; no conclusion is made here about model-output inheritance.
        - No dataset currently supplies measured treatment-response or harvest outcomes. Keep model claims and farmer-facing prescriptions behind validation and agronomist review.
        - Supabase remains demo-only until retention, access control, backup, and farmer-data policies are established.

        ## AI review prompt

        ```text
        {ai_prompt}
        ```

        ## Source-specific notes

        {provider_sections}
        """
    ).format(
        ai_prompt=build_ai_prompt(),
        provider_sections=provider_sections,
    )

    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(report.strip() + "\n")
        print(f"Wrote approval audit to {args.output}")
    else:
        print(report.strip())


if __name__ == "__main__":
    main()
