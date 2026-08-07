"""Validation and half-hourly energy matching for uploaded meter data.

The public entry point is :func:`run_matching_engine`. It parses consumption
and generation templates, aligns records by date, applies each customer's
generation share, and returns interval-level results plus summary totals.

Energy values are expressed in kWh. A spreadsheet row represents one meter on
one date and contains 48 half-hourly readings.
"""

from __future__ import annotations

import csv
import json
import math
import re
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from io import BytesIO, StringIO
from typing import Any
from xml.etree import ElementTree


class MatchingModelError(ValueError):
    """Raised when an uploaded file or matching option is invalid."""

    pass


@dataclass
class UploadedFile:
    """A file received by the API before it has been parsed."""

    filename: str
    content: bytes


@dataclass
class ParsedEnergyRecord:
    """One validated spreadsheet row containing a full day of readings."""

    record_number: int
    site_id: str
    mpan: str
    date: str
    intervals: list[float]
    interval_labels: list[str] | None = None


# Templates label an interval by its end time: 00:30 through 00:00.
HALF_HOURLY_INTERVALS = [
    f"{(((index + 1) * 30) % (24 * 60)) // 60:02d}:{(((index + 1) * 30) % (24 * 60)) % 60:02d}"
    for index in range(48)
]
TEMPLATE_HEADERS = {
    "consumption": [
        "Site ID",
        "MPAN",
        "Date (dd/mm/yyyy)",
        *HALF_HOURLY_INTERVALS,
        "Daily Total",
    ],
    "generation": [
        "Site ID",
        "MPAN",
        "Date (dd/mm/yyyy)",
        *HALF_HOURLY_INTERVALS,
        "Daily Total",
    ],
}
CLOCK_CHANGE_HEADERS = ["Clock Change Period 1", "Clock Change Period 2"]
LEGACY_RESERVED_HEADERS = ["Reserved 1", "Reserved 2"]
FIRST_INTERVAL_COLUMN_INDEX = 3
LAST_INTERVAL_COLUMN_INDEX = 50
DATE_COLUMN_INDEX = 2
ALLOWED_FILE_PATTERN = re.compile(r"\.(xlsx|csv)$", re.IGNORECASE)
EXCEL_DATE_EPOCH = datetime(1899, 12, 30, tzinfo=timezone.utc)
DAILY_TOTAL_TOLERANCE = 0.000001
UNMAPPED_COMMODITY_LABEL = "Unmapped commodity"
MATCHING_APPROACH_LABELS = {
    # The carry-forward keys are retained for compatibility with saved frontend
    # results and API clients; their current behavior is period aggregation.
    "carry-forward": "Aggregate (Daily)",
    "carry-forward-hourly": "Aggregate (Hourly)",
    "non-carry-forward": "Half-hourly matching",
}


def validate_energy_file_template(
    file: UploadedFile,
    upload_type: str,
    settlement_calendar_json: str = "[]",
) -> list[str]:
    """Validate an upload and return non-fatal references to empty cells."""

    _validate_upload_type(upload_type)
    _validate_file_extension(file.filename)

    try:
        rows = read_spreadsheet_rows(file)
    except Exception as exc:
        raise MatchingModelError(
            "The file could not be read. Please reupload a valid template-based .xlsx or .csv file."
        ) from exc

    validate_template_headers(upload_type, rows[0] if rows else [])
    calendar = parse_settlement_calendar(settlement_calendar_json)
    validation_result = validate_energy_data_rows(upload_type, rows, calendar)

    if validation_result["errors"]:
        raise MatchingModelError(
            format_file_validation_errors(upload_type, validation_result["errors"])
        )

    parse_energy_records(rows, upload_type, calendar)

    return validation_result["empty_cells"]


def get_generation_sources(
    file: UploadedFile,
    settlement_calendar_json: str = "[]",
) -> list[dict[str, str]]:
    """Return each distinct generator MPAN for the allocation UI."""

    generation_records = parse_energy_file(
        file, "generation", settlement_calendar_json
    )
    generation_sources: list[dict[str, str]] = []
    seen_mpan_keys = set()

    for generation_record in generation_records:
        mpan_key = normalize_lookup_value(generation_record.mpan)

        if mpan_key in seen_mpan_keys:
            continue

        seen_mpan_keys.add(mpan_key)
        generation_sources.append(
            {
                "siteId": generation_record.site_id,
                "mpan": generation_record.mpan,
            }
        )

    return generation_sources


def run_matching_engine(
    consumption_file: UploadedFile,
    generation_file: UploadedFile,
    customer_allocations_json: str = "[]",
    generator_commodity_mappings_json: str = "[]",
    matching_approach: str = "non-carry-forward",
    settlement_calendar_json: str = "[]",
) -> dict[str, Any]:
    """Run validation, matching, and aggregation for a pair of energy files.

    Consumer and generator counts do not need to be equal. Generator readings
    are combined by date, while each consumer is evaluated separately using
    its configured allocation percentage.
    """

    normalized_matching_approach = normalize_matching_approach(matching_approach)
    # Parsing performs all structural and cell-level validation before any
    # matching takes place.
    consumption_records = parse_energy_file(
        consumption_file, "consumption", settlement_calendar_json
    )
    generation_records = parse_energy_file(
        generation_file, "generation", settlement_calendar_json
    )

    if not consumption_records or not generation_records:
        raise MatchingModelError(
            "Both files must contain at least one data row below the template header."
        )

    # Distinct MPAN counts are used for display only; they do not restrict which
    # files can be matched.
    matching_type_label = get_matching_type_label(
        consumption_records,
        generation_records,
    )

    customer_allocation_map = build_customer_allocation_map(
        parse_customer_allocations(customer_allocations_json)
    )
    matching_warnings = build_matching_warnings(
        consumption_records,
        customer_allocation_map,
    )
    generator_commodity_map = build_generator_commodity_map(
        parse_generator_commodity_mappings(generator_commodity_mappings_json)
    )
    # Pairing aligns data by date. Aggregate modes retain separate consumer rows
    # because each consumer has its own allocated share of generation.
    matching_record_pairs = (
        build_aggregate_matching_record_pairs(
            consumption_records,
            generation_records,
        )
        if normalized_matching_approach in {"carry-forward", "carry-forward-hourly"}
        else build_matching_record_pairs(
            consumption_records,
            generation_records,
        )
    )
    generation_records_by_date = group_energy_records_by_date(generation_records)
    commodity_generation_totals = (
        build_commodity_generation_totals(
            generation_records,
            generator_commodity_map,
        )
        if generator_commodity_map
        else {}
    )
    commodity_matched_totals: dict[tuple[str, str, str], dict[str, Any]] = {}

    if normalized_matching_approach == "carry-forward":
        results = build_daily_aggregate_matching_results(
            matching_record_pairs,
            customer_allocation_map,
            generation_records_by_date,
            generator_commodity_map,
            commodity_matched_totals,
        )
    elif normalized_matching_approach == "carry-forward-hourly":
        results = build_hourly_aggregate_matching_results(
            matching_record_pairs,
            customer_allocation_map,
            generation_records_by_date,
            generator_commodity_map,
            commodity_matched_totals,
        )
    else:
        results = build_half_hourly_matching_results(
            matching_record_pairs,
            customer_allocation_map,
            generation_records_by_date,
            generator_commodity_map,
            commodity_matched_totals,
        )

    summary = build_matching_summary(results)
    generated_at = now_iso()

    return {
        "id": str(uuid.uuid4()),
        "title": f"{consumption_file.filename} vs {generation_file.filename}",
        "createdBy": "Unknown user",
        "createdAt": generated_at,
        "consumptionFileName": consumption_file.filename,
        "generationFileName": generation_file.filename,
        "generatedAt": generated_at,
        "matchingTypeLabel": matching_type_label,
        "matchingApproach": normalized_matching_approach,
        "matchingApproachLabel": MATCHING_APPROACH_LABELS[
            normalized_matching_approach
        ],
        "matchingWarnings": matching_warnings,
        "commodityEnergyResults": aggregate_commodity_energy_results(
            build_commodity_energy_results(
                commodity_generation_totals,
                commodity_matched_totals,
            ),
            normalized_matching_approach,
        ),
        "results": results,
        "summary": summary,
    }


def build_half_hourly_matching_results(
    matching_record_pairs: list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]],
    customer_allocation_map: dict[str, dict[str, Any]],
    generation_records_by_date: dict[str, list[ParsedEnergyRecord]],
    generator_commodity_map: dict[str, str],
    commodity_matched_totals: dict[tuple[str, str, str], dict[str, Any]],
) -> list[dict[str, Any]]:
    """Match consumption only against generation in the same half hour."""

    results: list[dict[str, Any]] = []

    for record_index, (consumption_record, generation_record) in enumerate(
        matching_record_pairs
    ):
        customer_allocation, share_percentage, allocation_source = (
            get_customer_allocation_context(
                consumption_record,
                customer_allocation_map,
            )
        )

        for interval_index, interval in enumerate(
            consumption_record.interval_labels or HALF_HOURLY_INTERVALS
        ):
            consumption_kwh = consumption_record.intervals[interval_index]
            generation_kwh = generation_record.intervals[interval_index]
            interval_match = calculate_consumer_interval_match(
                consumption_kwh=consumption_kwh,
                total_generation_kwh=generation_kwh,
                share_percentage=share_percentage,
            )

            if generator_commodity_map:
                add_commodity_matched_energy(
                    commodity_matched_totals,
                    generation_records_by_date.get(generation_record.date, []),
                    interval_index,
                    interval,
                    interval_match["matchedEnergyKwh"],
                    generator_commodity_map,
                )

            results.append(
                create_matching_result_row(
                    record_index,
                    interval,
                    consumption_record,
                    generation_record,
                    consumption_kwh,
                    generation_kwh,
                    interval_match["allocatedGenerationKwh"],
                    interval_match["matchedEnergyKwh"],
                    interval_match["unmatchedConsumptionKwh"],
                    interval_match["excessAllocatedGenerationKwh"],
                    share_percentage,
                    allocation_source,
                    customer_allocation,
                )
            )

    return results


def build_daily_aggregate_matching_results(
    matching_record_pairs: list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]],
    customer_allocation_map: dict[str, dict[str, Any]],
    generation_records_by_date: dict[str, list[ParsedEnergyRecord]],
    generator_commodity_map: dict[str, str],
    commodity_matched_totals: dict[tuple[str, str, str], dict[str, Any]],
) -> list[dict[str, Any]]:
    """Net each consumer's consumption and allocated generation by day."""

    return build_aggregate_matching_results(
        matching_record_pairs,
        customer_allocation_map,
        generation_records_by_date,
        generator_commodity_map,
        commodity_matched_totals,
        intervals_per_window=0,
    )


def build_hourly_aggregate_matching_results(
    matching_record_pairs: list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]],
    customer_allocation_map: dict[str, dict[str, Any]],
    generation_records_by_date: dict[str, list[ParsedEnergyRecord]],
    generator_commodity_map: dict[str, str],
    commodity_matched_totals: dict[tuple[str, str, str], dict[str, Any]],
) -> list[dict[str, Any]]:
    """Net consumption and allocated generation within each clock hour."""

    return build_aggregate_matching_results(
        matching_record_pairs,
        customer_allocation_map,
        generation_records_by_date,
        generator_commodity_map,
        commodity_matched_totals,
        intervals_per_window=2,
    )


def build_aggregate_matching_results(
    matching_record_pairs: list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]],
    customer_allocation_map: dict[str, dict[str, Any]],
    generation_records_by_date: dict[str, list[ParsedEnergyRecord]],
    generator_commodity_map: dict[str, str],
    commodity_matched_totals: dict[tuple[str, str, str], dict[str, Any]],
    intervals_per_window: int,
) -> list[dict[str, Any]]:
    """Net energy inside fixed windows and return one row per matching window."""

    results: list[dict[str, Any]] = []

    for record_index, (consumption_record, generation_record) in enumerate(
        matching_record_pairs
    ):
        customer_allocation, share_percentage, allocation_source = (
            get_customer_allocation_context(
                consumption_record,
                customer_allocation_map,
            )
        )

        record_interval_count = len(consumption_record.intervals)
        window_size = intervals_per_window or record_interval_count
        for window_start in range(0, record_interval_count, window_size):
            window_end = min(window_start + window_size, record_interval_count)
            interval_indices = range(window_start, window_end)
            total_consumption_kwh = sum(
                consumption_record.intervals[index] for index in interval_indices
            )
            total_allocated_generation_kwh = sum(
                generation_record.intervals[index] * (share_percentage / 100)
                for index in interval_indices
            )
            total_matched_kwh = min(
                total_consumption_kwh,
                total_allocated_generation_kwh,
            )
            total_excess_kwh = max(
                total_allocated_generation_kwh - total_consumption_kwh,
                0.0,
            )

            total_generation_kwh = sum(
                generation_record.intervals[index] for index in interval_indices
            )
            interval = get_aggregate_interval_label(
                consumption_record,
                window_end,
                intervals_per_window,
            )
            results.append(
                create_matching_result_row(
                    record_index,
                    interval,
                    consumption_record,
                    generation_record,
                    total_consumption_kwh,
                    total_generation_kwh,
                    total_allocated_generation_kwh,
                    total_matched_kwh,
                    max(total_consumption_kwh - total_matched_kwh, 0.0),
                    total_excess_kwh,
                    share_percentage,
                    allocation_source,
                    customer_allocation,
                )
            )

            if generator_commodity_map and total_allocated_generation_kwh > 0:
                for interval_index in interval_indices:
                    allocated_generation_kwh = (
                        generation_record.intervals[interval_index]
                        * (share_percentage / 100)
                    )
                    matched_source_kwh = total_matched_kwh * (
                        allocated_generation_kwh / total_allocated_generation_kwh
                    )
                    add_commodity_matched_energy(
                        commodity_matched_totals,
                        generation_records_by_date.get(generation_record.date, []),
                        interval_index,
                        (generation_record.interval_labels or HALF_HOURLY_INTERVALS)[interval_index],
                        matched_source_kwh,
                        generator_commodity_map,
                    )

    return results


def get_aggregate_interval_label(
    record: ParsedEnergyRecord,
    window_end: int,
    intervals_per_window: int,
) -> str:
    if intervals_per_window == 0:
        return "Daily"

    return (record.interval_labels or HALF_HOURLY_INTERVALS)[window_end - 1]


def get_customer_allocation_context(
    consumption_record: ParsedEnergyRecord,
    customer_allocation_map: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any] | None, float, str]:
    """Resolve a consumer's share, defaulting to 100% when unregistered."""

    customer_allocation = customer_allocation_map.get(
        get_energy_record_lookup_key(consumption_record.site_id, consumption_record.mpan)
    )
    share_percentage = (
        customer_allocation["sharePercentage"] if customer_allocation else 100.0
    )
    allocation_source = (
        "registered-customer" if customer_allocation else "default-100-percent"
    )

    return customer_allocation, share_percentage, allocation_source


def create_matching_result_row(
    record_index: int,
    interval: str,
    consumption_record: ParsedEnergyRecord,
    generation_record: ParsedEnergyRecord,
    consumption_kwh: float,
    generation_kwh: float,
    allocated_generation_kwh: float,
    matched_energy_kwh: float,
    unmatched_consumption_kwh: float,
    excess_generation_kwh: float,
    share_percentage: float,
    allocation_source: str,
    customer_allocation: dict[str, Any] | None,
) -> dict[str, Any]:
    row = {
        "id": f"{record_index + 1}-{interval}",
        "recordNumber": consumption_record.record_number,
        "siteId": consumption_record.site_id or generation_record.site_id,
        "mpan": consumption_record.mpan or generation_record.mpan,
        "date": consumption_record.date or generation_record.date,
        "interval": interval,
        "consumptionKwh": consumption_kwh,
        "generationKwh": generation_kwh,
        "allocatedGenerationKwh": allocated_generation_kwh,
        "matchedEnergyKwh": matched_energy_kwh,
        "unmatchedConsumptionKwh": unmatched_consumption_kwh,
        "excessGenerationKwh": excess_generation_kwh,
        "consumptionMatchingPercentage": calculate_matching_percentage(
            consumption_kwh,
            matched_energy_kwh,
        ),
        "customerSharePercentage": share_percentage,
        "allocationSource": allocation_source,
    }

    if customer_allocation:
        row["customerName"] = customer_allocation["customerName"]
        row["contractId"] = customer_allocation["contractId"]

    return row


def calculate_matching_percentage(
    consumption_kwh: float,
    matched_energy_kwh: float,
) -> float:
    """Return the percentage of consumption covered, capped at 100%."""

    return (
        0.0
        if consumption_kwh == 0
        else min((matched_energy_kwh / consumption_kwh) * 100, 100)
    )


def build_matching_summary(results: list[dict[str, Any]]) -> dict[str, float]:
    """Aggregate interval rows into totals for the result dashboard."""

    summary = {
        "totalConsumptionKwh": 0.0,
        "totalGenerationKwh": 0.0,
        "totalMatchedEnergyKwh": 0.0,
        "totalUnmatchedConsumptionKwh": 0.0,
        "totalExcessGenerationKwh": 0.0,
        "overallConsumptionMatchingPercentage": 0.0,
    }

    for row in results:
        summary["totalConsumptionKwh"] += row["consumptionKwh"]
        summary["totalGenerationKwh"] += row["allocatedGenerationKwh"]
        summary["totalMatchedEnergyKwh"] += row["matchedEnergyKwh"]
        summary["totalUnmatchedConsumptionKwh"] += row["unmatchedConsumptionKwh"]
        summary["totalExcessGenerationKwh"] += row["excessGenerationKwh"]

    summary["overallConsumptionMatchingPercentage"] = (
        0.0
        if summary["totalConsumptionKwh"] == 0
        else (summary["totalMatchedEnergyKwh"] / summary["totalConsumptionKwh"]) * 100
    )

    return summary


def build_matching_warnings(
    consumption_records: list[ParsedEnergyRecord],
    customer_allocation_map: dict[str, dict[str, Any]],
) -> list[str]:
    consumption_record_keys = {
        get_energy_record_lookup_key(record.site_id, record.mpan)
        for record in consumption_records
    }

    if len(consumption_record_keys) <= 1:
        return []

    has_missing_customer_allocation = any(
        record_key not in customer_allocation_map
        for record_key in consumption_record_keys
    )

    if not has_missing_customer_allocation:
        return []

    return [
        "Multiple customer sites were matched without contract allocation information for one or more customers. Those customers defaulted to 100%, which may double count allocated generation. Please set up the contract information and upload the data again."
    ]


def get_matching_type_label(
    consumption_records: list[ParsedEnergyRecord],
    generation_records: list[ParsedEnergyRecord],
) -> str:
    """Describe the run using counts of distinct consumer/generator MPANs."""

    has_multiple_consumers = count_distinct_mpans(consumption_records) > 1
    has_multiple_generators = count_distinct_mpans(generation_records) > 1

    if has_multiple_consumers and has_multiple_generators:
        return "Multiple consumer sites are matched against with multiple generators"

    if has_multiple_consumers:
        return "Multiple consumer sites are matched against with 1 generator"

    if has_multiple_generators:
        return "1 consumer site is matched against with multiple generators"

    return "1 consumer site is matched against with 1 generator"


def count_distinct_mpans(records: list[ParsedEnergyRecord]) -> int:
    return len({normalize_lookup_value(record.mpan) for record in records})


def calculate_consumer_interval_match(
    *, consumption_kwh: float, total_generation_kwh: float, share_percentage: float
) -> dict[str, float]:
    """Calculate the half-hourly result for one consumer and interval."""

    # A consumer can use only its contracted share of total generation.
    allocated_generation_kwh = total_generation_kwh * (share_percentage / 100)
    # Matching is bounded by both demand and the allocated supply.
    matched_energy_kwh = min(consumption_kwh, allocated_generation_kwh)
    unmatched_consumption_kwh = max(consumption_kwh - allocated_generation_kwh, 0)
    excess_allocated_generation_kwh = max(
        allocated_generation_kwh - consumption_kwh, 0
    )
    matching_percentage = (
        0.0
        if consumption_kwh == 0
        else min((matched_energy_kwh / consumption_kwh) * 100, 100)
    )

    return {
        "allocatedGenerationKwh": allocated_generation_kwh,
        "matchedEnergyKwh": matched_energy_kwh,
        "unmatchedConsumptionKwh": unmatched_consumption_kwh,
        "excessAllocatedGenerationKwh": excess_allocated_generation_kwh,
        "matchingPercentage": matching_percentage,
    }


def parse_energy_file(
    file: UploadedFile,
    upload_type: str,
    settlement_calendar_json: str = "[]",
) -> list[ParsedEnergyRecord]:
    """Validate a CSV/XLSX template and convert its data rows to records."""

    _validate_upload_type(upload_type)
    _validate_file_extension(file.filename)

    rows = read_spreadsheet_rows(file)
    validate_template_headers(upload_type, rows[0] if rows else [])
    calendar = parse_settlement_calendar(settlement_calendar_json)
    validation_result = validate_energy_data_rows(upload_type, rows, calendar)

    if validation_result["errors"]:
        raise MatchingModelError(
            format_file_validation_errors(upload_type, validation_result["errors"])
        )

    return parse_energy_records(rows, upload_type, calendar)


def parse_energy_records(
    rows: list[list[str]],
    upload_type: str,
    calendar: dict[str, str],
) -> list[ParsedEnergyRecord]:
    """Parse validated rows and impute missing half-hourly readings."""

    daily_total_column_index = get_daily_total_column_index(rows[0] if rows else [])

    records: list[ParsedEnergyRecord] = []
    for row_index, row in enumerate(rows[1:], start=2):
        record = parse_energy_record(
            row,
            row_index,
            upload_type,
            daily_total_column_index,
            calendar,
        )
        if record is not None:
            records.append(record)

    impute_missing_energy_values(records, upload_type)

    return records


def parse_energy_record(
    row: list[str],
    record_number: int,
    upload_type: str,
    daily_total_column_index: int | None,
    calendar: dict[str, str],
) -> ParsedEnergyRecord | None:
    """Parse one spreadsheet row; return ``None`` for a completely blank row."""

    has_data = any(cell.strip() for cell in row)

    if not has_data:
        return None

    date = normalize_energy_date_value(cell_at(row, DATE_COLUMN_INDEX))

    if not date:
        raise MatchingModelError(
            f"The {get_upload_type_label(upload_type)} file contains empty value in {get_cell_reference(record_number, DATE_COLUMN_INDEX)}. Date is required."
        )

    interval_cells = row[FIRST_INTERVAL_COLUMN_INDEX : LAST_INTERVAL_COLUMN_INDEX + 1]
    standard_intervals = [
        parse_optional_energy_value(
            interval_cells[index] if index < len(interval_cells) else "",
            record_number,
            FIRST_INTERVAL_COLUMN_INDEX + index + 1,
        )
        for index in range(len(HALF_HOURLY_INTERVALS))
    ]
    day_type = calendar.get(date)
    profile_type = get_clock_change_profile_type(
        row,
        daily_total_column_index,
        day_type,
    )
    interval_labels = list(HALF_HOURLY_INTERVALS)
    intervals = standard_intervals

    if profile_type == "46-period":
        # The periods ending 01:30 and 02:00 do not exist on a UK short day.
        intervals = standard_intervals[:2] + standard_intervals[4:]
        interval_labels = interval_labels[:2] + interval_labels[4:]
    elif profile_type in {"50-period", "50-period-impute"}:
        reserve_start = (daily_total_column_index or 53) - 2
        reserve_values = [
            parse_optional_energy_value(
                cell_at(row, reserve_start + index),
                record_number,
                reserve_start + index + 1,
            )
            for index in range(2)
        ]
        intervals = standard_intervals[:4] + reserve_values + standard_intervals[4:]
        interval_labels = (
            interval_labels[:4]
            + ["01:30 GMT", "02:00 GMT"]
            + interval_labels[4:]
        )
    if daily_total_column_index is not None and all(
        math.isfinite(value) for value in intervals
    ):
        daily_total_kwh = parse_energy_value(
            cell_at(row, daily_total_column_index),
            record_number,
            daily_total_column_index + 1,
        )
        validate_daily_total_value(
            upload_type,
            record_number,
            daily_total_column_index,
            sum(intervals),
            daily_total_kwh,
        )

    return ParsedEnergyRecord(
        record_number=record_number,
        site_id=cell_at(row, 0).strip() or "0",
        mpan=cell_at(row, 1).strip() or "0",
        date=date,
        intervals=intervals,
        interval_labels=interval_labels,
    )


def parse_energy_value(value: str, record_number: int, column_number: int) -> float:
    """Parse a non-negative kWh value, treating an empty validation cell as zero."""

    trimmed_value = value.strip()

    if not trimmed_value:
        return 0.0

    try:
        numeric_value = float(trimmed_value.replace(",", ""))
    except ValueError as exc:
        raise MatchingModelError(
            get_energy_value_error_message(record_number, column_number)
        ) from exc

    if not math.isfinite(numeric_value) or numeric_value < 0:
        raise MatchingModelError(
            get_energy_value_error_message(record_number, column_number)
        )

    return numeric_value


def parse_optional_energy_value(
    value: str,
    record_number: int,
    column_number: int,
) -> float:
    """Parse an interval value while preserving an empty cell as missing."""

    if not value.strip():
        return math.nan

    return parse_energy_value(value, record_number, column_number)


def get_clock_change_profile_type(
    row: list[str],
    daily_total_column_index: int | None,
    configured_day_type: str | None,
) -> str:
    """Resolve the actual 46/48/50-period shape allowed by the calendar rule."""

    standard_values = [
        cell_at(row, index).strip()
        for index in range(
            FIRST_INTERVAL_COLUMN_INDEX,
            LAST_INTERVAL_COLUMN_INDEX + 1,
        )
    ]
    has_clock_change_columns = daily_total_column_index == 53
    clock_change_values = (
        [cell_at(row, 51).strip(), cell_at(row, 52).strip()]
        if has_clock_change_columns
        else ["", ""]
    )
    populated_periods = sum(bool(value) for value in standard_values) + sum(
        bool(value) for value in clock_change_values
    )
    has_short_day_gap = not standard_values[2] and not standard_values[3]

    if configured_day_type == "46-period":
        if populated_periods == 46 and has_short_day_gap:
            return "46-period"
        return "48-period"

    if configured_day_type == "50-period":
        if populated_periods == 50:
            return "50-period"
        if populated_periods == 46:
            return "50-period-impute"
        return "48-period"

    return "48-period"


def impute_missing_energy_values(
    records: list[ParsedEnergyRecord],
    upload_type: str,
) -> None:
    """Fill missing readings using a four-week average or previous-week fallback.

    The primary estimate uses actual readings from the same half-hour 7, 14,
    21 and 28 days earlier. All four must be available. Otherwise, the actual
    reading from seven days earlier is used. Imputed readings are never reused
    as historical inputs. Values that satisfy neither rule are fatal.
    """

    original_intervals = {
        (
            get_energy_record_lookup_key(record.site_id, record.mpan),
            get_energy_date_ordinal(record.date),
            label,
        ): value
        for record in records
        for label, value in zip(
            record.interval_labels or HALF_HOURLY_INTERVALS,
            record.intervals,
        )
    }
    unresolved_cells: list[str] = []

    for record in records:
        record_key = get_energy_record_lookup_key(record.site_id, record.mpan)
        date_ordinal = get_energy_date_ordinal(record.date)

        for interval_index, value in enumerate(record.intervals):
            if math.isfinite(value):
                continue

            interval_label = (record.interval_labels or HALF_HOURLY_INTERVALS)[
                interval_index
            ]
            historical_values = (
                [
                    get_original_interval_value(
                        original_intervals,
                        record_key,
                        date_ordinal - day_offset,
                        interval_label,
                    )
                    for day_offset in (7, 14, 21, 28)
                ]
                if date_ordinal is not None
                else [None, None, None, None]
            )

            if all(
                historical_value is not None
                for historical_value in historical_values
            ):
                record.intervals[interval_index] = (
                    sum(value for value in historical_values if value is not None) / 4
                )
                continue

            previous_week_value = historical_values[0]

            if previous_week_value is not None:
                record.intervals[interval_index] = previous_week_value
                continue

            unresolved_cells.append(
                get_cell_reference(
                    record.record_number,
                    FIRST_INTERVAL_COLUMN_INDEX + interval_index,
                )
            )

    if unresolved_cells:
        cells = ", ".join(unresolved_cells[:20])
        remaining_count = len(unresolved_cells) - 20
        suffix = f" and {remaining_count} more" if remaining_count > 0 else ""
        raise MatchingModelError(
            f"The {get_upload_type_label(upload_type)} file has missing readings that cannot be imputed: {cells}{suffix}. Four actual weekly readings were not available and the previous-week reading was also missing."
        )


def get_original_interval_value(
    original_intervals: dict[tuple[str, int | None, str], float],
    record_key: str,
    date_ordinal: int | None,
    interval_label: str,
) -> float | None:
    if date_ordinal is None:
        return None

    # Repeated long-day periods use the corresponding ordinary settlement
    # period from earlier weeks as their historical estimate.
    historical_label = {
        "01:30 GMT": "01:30",
        "02:00 GMT": "02:00",
    }.get(interval_label, interval_label)
    value = original_intervals.get((record_key, date_ordinal, historical_label))
    if value is None:
        return None
    return value if math.isfinite(value) else None


def get_energy_date_ordinal(value: str) -> int | None:
    for date_format in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, date_format).date().toordinal()
        except ValueError:
            continue

    return None


def read_spreadsheet_rows(file: UploadedFile) -> list[list[str]]:
    """Read the first worksheet (or CSV) and discard fully blank rows."""

    if file.filename.lower().endswith(".csv"):
        return [
            row
            for row in read_csv_rows(file.content)
            if any(cell.strip() for cell in row)
        ]

    return [
        row
        for row in read_xlsx_rows(file.content)
        if any(cell.strip() for cell in row)
    ]


def read_csv_rows(content: bytes) -> list[list[str]]:
    text = decode_text(content).lstrip("\ufeff")
    return [list(row) for row in csv.reader(StringIO(text))]


def read_xlsx_rows(content: bytes) -> list[list[str]]:
    """Read XLSX XML directly to avoid requiring a spreadsheet dependency."""

    with zipfile.ZipFile(BytesIO(content)) as workbook:
        shared_strings = read_shared_strings(workbook)
        sheet_path = get_first_sheet_path(workbook)

        if not sheet_path:
            raise MatchingModelError("Worksheet not found")

        sheet_root = ElementTree.fromstring(workbook.read(sheet_path))

    rows = []
    sheet_rows = sheet_root.findall(".//{*}sheetData/{*}row")

    if not sheet_rows:
        sheet_rows = sheet_root.findall(".//{*}row")

    for row in sheet_rows:
        values: list[str] = []

        for cell in row.findall("{*}c"):
            cell_reference = cell.attrib.get("r", "")
            column_index = get_column_index(cell_reference)

            if column_index >= 0:
                while len(values) <= column_index:
                    values.append("")

                values[column_index] = read_xlsx_cell_value(cell, shared_strings)

        rows.append(values)

    return rows


def read_shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in workbook.namelist():
        return []

    root = ElementTree.fromstring(workbook.read("xl/sharedStrings.xml"))
    shared_strings = []

    for item in root.findall(".//{*}si"):
        shared_strings.append("".join(node.text or "" for node in item.findall(".//{*}t")))

    return shared_strings


def get_first_sheet_path(workbook: zipfile.ZipFile) -> str | None:
    if "xl/worksheets/sheet1.xml" in workbook.namelist():
        return "xl/worksheets/sheet1.xml"

    sheet_paths = sorted(
        path
        for path in workbook.namelist()
        if path.startswith("xl/worksheets/sheet") and path.endswith(".xml")
    )
    return sheet_paths[0] if sheet_paths else None


def read_xlsx_cell_value(cell: ElementTree.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")

    if cell_type == "s":
        value = get_xml_value(cell)
        try:
            return shared_strings[int(value)]
        except (ValueError, IndexError):
            return ""

    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//{*}t"))

    return normalize_display_value(get_xml_value(cell))


def get_xml_value(cell: ElementTree.Element) -> str:
    value = cell.find("{*}v")
    return value.text if value is not None and value.text is not None else ""


def validate_template_headers(upload_type: str, uploaded_headers: list[str]) -> None:
    """Require template columns in their expected order."""

    legacy_headers = TEMPLATE_HEADERS[upload_type]
    expected_headers = [*legacy_headers[:-1], *CLOCK_CHANGE_HEADERS, legacy_headers[-1]]
    legacy_reserved_headers = [
        *legacy_headers[:-1],
        *LEGACY_RESERVED_HEADERS,
        legacy_headers[-1],
    ]
    normalized_uploaded_headers = [normalize_header_value(header) for header in uploaded_headers]
    normalized_expected_headers = [normalize_header_value(header) for header in expected_headers]
    normalized_legacy_headers = [normalize_header_value(header) for header in legacy_headers]
    normalized_legacy_reserved_headers = [
        normalize_header_value(header) for header in legacy_reserved_headers
    ]
    expected_template = "consumption" if upload_type == "consumption" else "generation"

    is_legacy_template = normalized_uploaded_headers[: len(normalized_legacy_headers)] == normalized_legacy_headers
    is_reserved_template = normalized_uploaded_headers[: len(normalized_expected_headers)] == normalized_expected_headers
    is_legacy_reserved_template = (
        normalized_uploaded_headers[: len(normalized_legacy_reserved_headers)]
        == normalized_legacy_reserved_headers
    )

    if not is_legacy_template and not is_reserved_template and not is_legacy_reserved_template:
        raise MatchingModelError(
            f"This file does not match the {expected_template} template. Please reupload using the correct template."
        )


def validate_energy_data_rows(
    upload_type: str,
    rows: list[list[str]],
    calendar: dict[str, str],
) -> dict[str, list[str]]:
    """Collect fatal data errors and non-fatal empty-cell warnings."""

    empty_cells: list[str] = []
    errors: list[str] = []
    daily_total_column_index = get_daily_total_column_index(rows[0] if rows else [])
    warning_column_indices = [
        0,
        1,
        *range(FIRST_INTERVAL_COLUMN_INDEX, LAST_INTERVAL_COLUMN_INDEX + 1),
    ]

    if daily_total_column_index is not None:
        warning_column_indices.append(daily_total_column_index)

    # A meter may have many dates, but the same meter/date combination must
    # occur only once.
    record_rows_by_key: dict[tuple[str, str], list[int]] = {}

    for row_number, row in enumerate(rows[1:], start=2):
        if not any(cell.strip() for cell in row):
            continue

        date = normalize_energy_date_value(cell_at(row, DATE_COLUMN_INDEX))
        day_type = calendar.get(date)
        profile_type = get_clock_change_profile_type(
            row,
            daily_total_column_index,
            day_type,
        )

        if not date:
            errors.append(
                f"Empty Date in {get_cell_reference(row_number, DATE_COLUMN_INDEX)}."
            )
        else:
            record_key = get_energy_record_lookup_key(
                cell_at(row, 0).strip() or "0",
                cell_at(row, 1).strip() or "0",
            )
            duplicate_key = (record_key, normalize_lookup_value(date))

            record_rows_by_key.setdefault(duplicate_key, []).append(row_number)

        for column_index in warning_column_indices:
            if profile_type == "46-period" and column_index in {
                FIRST_INTERVAL_COLUMN_INDEX + 2,
                FIRST_INTERVAL_COLUMN_INDEX + 3,
            }:
                continue
            if not cell_at(row, column_index).strip():
                empty_cells.append(get_cell_reference(row_number, column_index))

        reserve_start = (daily_total_column_index or 53) - 2

        if day_type == "46-period":
            clock_change_values = (
                [cell_at(row, reserve_start + index).strip() for index in range(2)]
                if daily_total_column_index == 53
                else []
            )
            populated_periods = sum(
                bool(cell_at(row, column_index).strip())
                for column_index in range(
                    FIRST_INTERVAL_COLUMN_INDEX,
                    LAST_INTERVAL_COLUMN_INDEX + 1,
                )
            ) + sum(bool(value) for value in clock_change_values)
            if populated_periods > 48:
                errors.append(
                    f"The 46-period calendar date {date} cannot contain 50 readings. "
                    "Upload either 46 or 48 readings for this date."
                )

        row_has_empty_energy_value = any(
            not cell_at(row, column_index).strip()
            for column_index in range(
                FIRST_INTERVAL_COLUMN_INDEX,
                LAST_INTERVAL_COLUMN_INDEX + 1,
            )
        )
        interval_total_kwh = 0.0
        interval_values_are_valid = True

        for column_index in range(
            FIRST_INTERVAL_COLUMN_INDEX,
            LAST_INTERVAL_COLUMN_INDEX + 1,
        ):
            try:
                interval_total_kwh += parse_energy_value(
                    cell_at(row, column_index),
                    row_number,
                    column_index + 1,
                )
            except MatchingModelError as exc:
                interval_values_are_valid = False
                errors.append(str(exc))

        if profile_type == "50-period" and daily_total_column_index is not None:
            for reserve_index in range(2):
                try:
                    interval_total_kwh += parse_energy_value(
                        cell_at(row, reserve_start + reserve_index),
                        row_number,
                        reserve_start + reserve_index + 1,
                    )
                except MatchingModelError as exc:
                    interval_values_are_valid = False
                    errors.append(str(exc))

        if daily_total_column_index is None:
            continue

        daily_total_is_empty = not cell_at(row, daily_total_column_index).strip()

        try:
            daily_total_kwh = parse_energy_value(
                cell_at(row, daily_total_column_index),
                row_number,
                daily_total_column_index + 1,
            )
        except MatchingModelError as exc:
            errors.append(str(exc))
            continue

        if (
            interval_values_are_valid
            and not row_has_empty_energy_value
            and not daily_total_is_empty
        ):
            daily_total_error = get_daily_total_error(
                row_number,
                daily_total_column_index,
                interval_total_kwh,
                daily_total_kwh,
            )

            if daily_total_error:
                errors.append(daily_total_error)

    for duplicate_rows in record_rows_by_key.values():
        if len(duplicate_rows) > 1:
            row_list = ", ".join(str(row_number) for row_number in duplicate_rows)
            errors.append(f"Duplicate dates are found in rows {row_list}.")

    return {
        "errors": errors,
        "empty_cells": empty_cells,
    }


def get_daily_total_column_index(headers: list[str]) -> int | None:
    for index, header in enumerate(headers):
        if normalize_header_value(header) == "daily total":
            return index

    return None


def validate_daily_total_value(
    upload_type: str,
    row_number: int,
    daily_total_column_index: int,
    interval_total_kwh: float,
    daily_total_kwh: float,
) -> None:
    daily_total_error = get_daily_total_error(
        row_number,
        daily_total_column_index,
        interval_total_kwh,
        daily_total_kwh,
    )

    if not daily_total_error:
        return

    raise MatchingModelError(
        format_file_validation_errors(upload_type, [daily_total_error])
    )


def get_daily_total_error(
    row_number: int,
    daily_total_column_index: int,
    interval_total_kwh: float,
    daily_total_kwh: float,
) -> str:
    if abs(interval_total_kwh - daily_total_kwh) <= DAILY_TOTAL_TOLERANCE:
        return ""

    return f"Incorrect Daily Total in {get_cell_reference(row_number, daily_total_column_index)}."


def format_file_validation_errors(upload_type: str, errors: list[str]) -> str:
    bullet_list = "\n".join(f"- {error}" for error in errors)
    return f"The {get_upload_type_label(upload_type)} file has following errors:\n{bullet_list}"


def build_matching_record_pairs(
    consumption_records: list[ParsedEnergyRecord],
    generation_records: list[ParsedEnergyRecord],
) -> list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]]:
    """Align half-hourly records by date, filling missing sides with 0."""

    record_pairs: list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]] = []
    generation_records_by_date = build_generation_records_by_date(generation_records)
    consumption_dates = set()

    for consumption_record in consumption_records:
        consumption_dates.add(consumption_record.date)
        generation_record = generation_records_by_date.get(consumption_record.date)

        if generation_record is None:
            generation_record = create_zero_energy_record(consumption_record)

        record_pairs.append(align_energy_record_pair(consumption_record, generation_record))

    for generation_record in generation_records_by_date.values():
        if generation_record.date in consumption_dates:
            continue

        record_pairs.append(
            align_energy_record_pair(
                create_zero_energy_record(generation_record), generation_record
            )
        )

    return record_pairs


def build_aggregate_matching_record_pairs(
    consumption_records: list[ParsedEnergyRecord],
    generation_records: list[ParsedEnergyRecord],
) -> list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]]:
    """Build date-ordered pairs while preserving individual consumers."""

    record_pairs: list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]] = []
    consumption_records_by_date = group_energy_records_by_date(consumption_records)
    generation_records_by_date = build_generation_records_by_date(generation_records)
    distinct_consumption_records = get_distinct_consumption_records(
        consumption_records
    )
    ordered_dates = sorted(
        set(consumption_records_by_date) | set(generation_records_by_date),
        key=get_energy_date_sort_key,
    )

    for date in ordered_dates:
        generation_record = generation_records_by_date.get(date)
        daily_consumption_records = sorted(
            consumption_records_by_date.get(date, []),
            key=lambda record: record.record_number,
        )

        if daily_consumption_records:
            for consumption_record in daily_consumption_records:
                paired_generation = (
                    generation_record
                    if generation_record is not None
                    else create_zero_energy_record(consumption_record)
                )
                record_pairs.append(
                    align_energy_record_pair(consumption_record, paired_generation)
                )
            continue

        if generation_record is None:
            continue

        for consumption_record in distinct_consumption_records:
            record_pairs.append(
                (
                    create_zero_consumption_record_for_date(
                        consumption_record,
                        date,
                        generation_record.record_number,
                        generation_record,
                    ),
                    generation_record,
                )
            )

    return record_pairs


def get_distinct_consumption_records(
    consumption_records: list[ParsedEnergyRecord],
) -> list[ParsedEnergyRecord]:
    distinct_records: list[ParsedEnergyRecord] = []
    seen_record_keys = set()

    for consumption_record in consumption_records:
        record_key = get_energy_record_lookup_key(
            consumption_record.site_id,
            consumption_record.mpan,
        )

        if record_key in seen_record_keys:
            continue

        seen_record_keys.add(record_key)
        distinct_records.append(consumption_record)

    return distinct_records


def build_generation_records_by_date(
    generation_records: list[ParsedEnergyRecord],
) -> dict[str, ParsedEnergyRecord]:
    """Combine all generators into one interval-total record per date."""

    grouped_records: dict[str, list[ParsedEnergyRecord]] = {}

    for generation_record in generation_records:
        grouped_records.setdefault(generation_record.date, []).append(generation_record)

    return {
        date: aggregate_energy_records(records)
        for date, records in grouped_records.items()
    }


def group_energy_records_by_date(
    records: list[ParsedEnergyRecord],
) -> dict[str, list[ParsedEnergyRecord]]:
    grouped_records: dict[str, list[ParsedEnergyRecord]] = {}

    for record in records:
        grouped_records.setdefault(record.date, []).append(record)

    return grouped_records


def aggregate_energy_records(
    records: list[ParsedEnergyRecord],
) -> ParsedEnergyRecord:
    """Sum multiple generator records interval by interval."""

    first_record = records[0]
    interval_labels = get_combined_interval_labels(records)

    return ParsedEnergyRecord(
        record_number=first_record.record_number,
        site_id=merge_record_identifier(
            [record.site_id for record in records],
            "Multiple generators",
        ),
        mpan=merge_record_identifier(
            [record.mpan for record in records],
            "Multiple MPANs",
        ),
        date=first_record.date,
        intervals=[
            sum(get_record_interval_value(record, label) for record in records)
            for label in interval_labels
        ],
        interval_labels=interval_labels,
    )


def get_combined_interval_labels(records: list[ParsedEnergyRecord]) -> list[str]:
    """Return the chronological union of settlement periods in the records."""

    available_labels = {
        label
        for record in records
        for label in (record.interval_labels or HALF_HOURLY_INTERVALS)
    }
    chronological_labels = (
        HALF_HOURLY_INTERVALS[:4]
        + ["01:30 GMT", "02:00 GMT"]
        + HALF_HOURLY_INTERVALS[4:]
    )
    return [label for label in chronological_labels if label in available_labels]


def get_record_interval_value(record: ParsedEnergyRecord, label: str) -> float:
    labels = record.interval_labels or HALF_HOURLY_INTERVALS
    values_by_label = dict(zip(labels, record.intervals))
    return values_by_label.get(label, 0.0)


def align_energy_record_pair(
    consumption_record: ParsedEnergyRecord,
    generation_record: ParsedEnergyRecord,
) -> tuple[ParsedEnergyRecord, ParsedEnergyRecord]:
    """Align accepted 46/48/50-period profiles before interval matching."""

    labels = get_combined_interval_labels([consumption_record, generation_record])

    def aligned(record: ParsedEnergyRecord) -> ParsedEnergyRecord:
        return ParsedEnergyRecord(
            record_number=record.record_number,
            site_id=record.site_id,
            mpan=record.mpan,
            date=record.date,
            intervals=[get_record_interval_value(record, label) for label in labels],
            interval_labels=labels,
        )

    return aligned(consumption_record), aligned(generation_record)


def merge_record_identifier(values: list[str], multiple_value: str) -> str:
    normalized_values = {normalize_lookup_value(value) for value in values}

    if len(normalized_values) > 1:
        return multiple_value

    return values[0] if values else ""


def create_zero_energy_record(source_record: ParsedEnergyRecord) -> ParsedEnergyRecord:
    return ParsedEnergyRecord(
        record_number=source_record.record_number,
        site_id=source_record.site_id,
        mpan=source_record.mpan,
        date=source_record.date,
        intervals=[0.0] * len(source_record.intervals),
        interval_labels=source_record.interval_labels,
    )


def create_zero_consumption_record_for_date(
    source_record: ParsedEnergyRecord,
    date: str,
    record_number: int,
    shape_record: ParsedEnergyRecord,
) -> ParsedEnergyRecord:
    return ParsedEnergyRecord(
        record_number=record_number,
        site_id=source_record.site_id,
        mpan=source_record.mpan,
        date=date,
        intervals=[0.0] * len(shape_record.intervals),
        interval_labels=shape_record.interval_labels,
    )


def get_energy_date_sort_key(date: str) -> tuple[int, int, str]:
    for date_format in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            parsed_date = datetime.strptime(date, date_format)
        except ValueError:
            continue

        return (0, parsed_date.toordinal(), date)

    return (1, 0, date)


def get_upload_type_label(upload_type: str) -> str:
    return "consumption" if upload_type == "consumption" else "generation"


def get_cell_reference(row_number: int, column_index: int) -> str:
    return f"{get_column_name(column_index)}{row_number}"


def get_energy_value_error_message(row_number: int, column_number: int) -> str:
    return (
        f"Row {row_number}, column {get_column_name(column_number - 1)} "
        "must contain a non-negative numeric kWh value."
    )


def get_column_name(column_index: int) -> str:
    column_number = column_index + 1
    name = ""

    while column_number > 0:
        column_number, remainder = divmod(column_number - 1, 26)
        name = f"{chr(65 + remainder)}{name}"

    return name


def format_energy_number(value: float) -> str:
    formatted_value = f"{value:.6f}".rstrip("0").rstrip(".")
    return formatted_value or "0"


def normalize_header_value(value: str) -> str:
    normalized_value = normalize_display_value(value)
    time_match = re.match(r"^(\d{1,2}):(\d{2})(?::\d{2})?$", normalized_value)

    try:
        numeric_value = float(normalized_value)
    except ValueError:
        numeric_value = None

    if (
        normalized_value
        and numeric_value is not None
        and math.isfinite(numeric_value)
        and 0 <= numeric_value < 1
    ):
        return format_excel_time(numeric_value)

    if time_match:
        return f"{int(time_match.group(1)):02d}:{time_match.group(2)}"

    return normalized_value.lower()


def normalize_energy_date_value(value: str) -> str:
    normalized_value = normalize_display_value(value)

    try:
        numeric_value = float(normalized_value)
    except ValueError:
        numeric_value = None

    if (
        normalized_value
        and numeric_value is not None
        and math.isfinite(numeric_value)
        and 20_000 <= numeric_value <= 80_000
    ):
        return format_excel_date(numeric_value)

    return normalized_value


def format_excel_time(value: float) -> str:
    total_minutes = round(value * 24 * 60) % (24 * 60)
    return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def format_excel_date(value: float) -> str:
    date = EXCEL_DATE_EPOCH + timedelta(days=math.floor(value))
    return f"{date.day:02d}/{date.month:02d}/{date.year}"


def normalize_display_value(value: str) -> str:
    return str(value).strip()


def normalize_matching_approach(value: str) -> str:
    normalized_value = str(value).strip().lower()
    normalized_label_value = normalized_value.replace(" approach", "")

    if normalized_value in MATCHING_APPROACH_LABELS:
        return normalized_value

    for approach, label in MATCHING_APPROACH_LABELS.items():
        if normalized_value == label.lower():
            return approach

    if normalized_label_value in {"carry forward", "carry-forward"}:
        return "carry-forward"

    if normalized_label_value in {
        "non carry forward",
        "non-carry forward",
        "non-carry-forward",
    }:
        return "non-carry-forward"

    raise MatchingModelError("Unknown matching approach.")


def parse_settlement_calendar(value: str) -> dict[str, str]:
    try:
        entries = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}

    if not isinstance(entries, list):
        return {}

    calendar: dict[str, str] = {}
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("status") != "Active":
            continue
        day_type = entry.get("dayType")
        date = normalize_calendar_date(str(entry.get("date", "")))
        if date and day_type in {"46-period", "50-period"}:
            calendar[date] = day_type
    return calendar


def normalize_calendar_date(value: str) -> str:
    normalized = normalize_energy_date_value(value)
    for date_format in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(normalized, date_format)
            return f"{parsed.day:02d}/{parsed.month:02d}/{parsed.year}"
        except ValueError:
            continue
    return normalized


def get_column_index(cell_reference: str) -> int:
    match = re.match(r"([A-Z]+)", cell_reference)

    if not match:
        return -1

    column_number = 0
    for character in match.group(1):
        column_number = column_number * 26 + ord(character) - 64

    return column_number - 1


def parse_customer_allocations(raw_value: str) -> list[dict[str, Any]]:
    """Decode customer allocation JSON supplied with the API request."""

    if not raw_value:
        return []

    try:
        parsed_value = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise MatchingModelError("Customer allocation data could not be read.") from exc

    return parsed_value if isinstance(parsed_value, list) else []


def parse_generator_commodity_mappings(raw_value: str) -> list[dict[str, Any]]:
    if not raw_value:
        return []

    try:
        parsed_value = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise MatchingModelError("Generator commodity mapping data could not be read.") from exc

    return parsed_value if isinstance(parsed_value, list) else []


def build_customer_allocation_map(
    customer_allocations: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Index validated allocations by normalized Site ID and MPAN."""

    customer_allocation_map = {}

    for customer_allocation in customer_allocations:
        normalized_allocation = normalize_customer_allocation(customer_allocation)

        if normalized_allocation is None:
            continue

        customer_allocation_map[
            get_energy_record_lookup_key(
                normalized_allocation["siteId"], normalized_allocation["mpan"]
            )
        ] = normalized_allocation

    return customer_allocation_map


def build_generator_commodity_map(
    generator_commodity_mappings: list[dict[str, Any]],
) -> dict[str, str]:
    generator_commodity_map = {}

    for mapping in generator_commodity_mappings:
        if not isinstance(mapping, dict):
            continue

        mpan = str(mapping.get("mpan", "")).strip()

        if not mpan:
            continue

        generator_commodity_map[normalize_lookup_value(mpan)] = str(
            mapping.get("commodity", "")
        ).strip()

    return generator_commodity_map


def build_commodity_generation_totals(
    generation_records: list[ParsedEnergyRecord],
    generator_commodity_map: dict[str, str],
) -> dict[tuple[str, str, str], dict[str, Any]]:
    commodity_totals: dict[tuple[str, str, str], dict[str, Any]] = {}

    for generation_record in generation_records:
        commodity = get_generator_commodity(
            generation_record,
            generator_commodity_map,
        )

        for interval_index, interval in enumerate(
            generation_record.interval_labels or HALF_HOURLY_INTERVALS
        ):
            generation_kwh = generation_record.intervals[interval_index]

            if generation_kwh == 0:
                continue

            current_total = get_or_create_commodity_energy_total(
                commodity_totals,
                commodity,
                generation_record.date,
                interval,
            )
            current_total["generationKwh"] += generation_kwh

    return commodity_totals


def add_commodity_matched_energy(
    commodity_totals: dict[tuple[str, str, str], dict[str, Any]],
    source_generation_records: list[ParsedEnergyRecord],
    interval_index: int,
    interval: str,
    matched_energy_kwh: float,
    generator_commodity_map: dict[str, str],
) -> None:
    if matched_energy_kwh == 0 or not source_generation_records:
        return

    total_generation_kwh = sum(
        get_record_interval_value(record, interval)
        for record in source_generation_records
    )

    if total_generation_kwh <= 0:
        return

    for generation_record in source_generation_records:
        source_generation_kwh = get_record_interval_value(generation_record, interval)

        if source_generation_kwh == 0:
            continue

        commodity = get_generator_commodity(
            generation_record,
            generator_commodity_map,
        )
        current_total = get_or_create_commodity_energy_total(
            commodity_totals,
            commodity,
            generation_record.date,
            interval,
        )
        current_total["matchedEnergyKwh"] += matched_energy_kwh * (
            source_generation_kwh / total_generation_kwh
        )


def build_commodity_energy_results(
    commodity_generation_totals: dict[tuple[str, str, str], dict[str, Any]],
    commodity_matched_totals: dict[tuple[str, str, str], dict[str, Any]],
) -> list[dict[str, Any]]:
    commodity_energy_results = []

    for key in sorted(
        set(commodity_generation_totals) | set(commodity_matched_totals)
    ):
        generation_total = commodity_generation_totals.get(key)
        matched_total = commodity_matched_totals.get(key)
        source_total = generation_total or matched_total

        if source_total is None:
            continue

        commodity_energy_results.append(
            {
                "commodity": source_total["commodity"],
                "date": source_total["date"],
                "interval": source_total["interval"],
                "generationKwh": generation_total["generationKwh"]
                if generation_total
                else 0.0,
                "matchedEnergyKwh": matched_total["matchedEnergyKwh"]
                if matched_total
                else 0.0,
            }
        )

    return commodity_energy_results


def aggregate_commodity_energy_results(
    commodity_results: list[dict[str, Any]],
    matching_approach: str,
) -> list[dict[str, Any]]:
    """Express commodity results at the selected matching granularity."""

    if matching_approach == "non-carry-forward":
        return commodity_results

    intervals_per_window = 0 if matching_approach == "carry-forward" else 2
    long_day_labels = (
        HALF_HOURLY_INTERVALS[:4]
        + ["01:30 GMT", "02:00 GMT"]
        + HALF_HOURLY_INTERVALS[4:]
    )
    interval_indices = {interval: index for index, interval in enumerate(long_day_labels)}
    aggregated: dict[tuple[str, str, str], dict[str, Any]] = {}

    for result in commodity_results:
        interval_index = interval_indices.get(result["interval"], 0)
        if intervals_per_window == 0:
            interval = "Daily"
        else:
            window_end = ((interval_index // intervals_per_window) + 1) * intervals_per_window
            interval = long_day_labels[min(window_end, len(long_day_labels)) - 1]
        key = (result["commodity"], result["date"], interval)
        current = aggregated.setdefault(
            key,
            {
                "commodity": result["commodity"],
                "date": result["date"],
                "interval": interval,
                "generationKwh": 0.0,
                "matchedEnergyKwh": 0.0,
            },
        )
        current["generationKwh"] += result["generationKwh"]
        current["matchedEnergyKwh"] += result["matchedEnergyKwh"]

    return list(aggregated.values())


def get_or_create_commodity_energy_total(
    commodity_totals: dict[tuple[str, str, str], dict[str, Any]],
    commodity: str,
    date: str,
    interval: str,
) -> dict[str, Any]:
    key = (normalize_lookup_value(commodity), date, interval)

    if key not in commodity_totals:
        commodity_totals[key] = {
            "commodity": commodity,
            "date": date,
            "interval": interval,
            "generationKwh": 0.0,
            "matchedEnergyKwh": 0.0,
        }

    return commodity_totals[key]


def get_generator_commodity(
    generation_record: ParsedEnergyRecord,
    generator_commodity_map: dict[str, str],
) -> str:
    commodity = generator_commodity_map.get(
        normalize_lookup_value(generation_record.mpan),
        "",
    )

    return commodity or UNMAPPED_COMMODITY_LABEL


def normalize_customer_allocation(
    customer_allocation: dict[str, Any],
) -> dict[str, Any] | None:
    site_id = str(customer_allocation.get("siteId", "")).strip()
    mpan = str(customer_allocation.get("mpan", "")).strip()
    customer_name = str(customer_allocation.get("customerName", "")).strip()
    contract_id = str(customer_allocation.get("contractId", "")).strip()
    share_percentage = customer_allocation.get("sharePercentage")

    if not site_id or not mpan:
        return None

    if isinstance(share_percentage, bool):
        return None

    if not isinstance(share_percentage, (int, float)) or not math.isfinite(
        share_percentage
    ):
        return None

    if share_percentage < 0 or share_percentage > 100:
        return None

    return {
        "siteId": site_id,
        "mpan": mpan,
        "customerName": customer_name,
        "contractId": contract_id,
        "sharePercentage": float(share_percentage),
    }


def get_energy_record_lookup_key(site_id: str, mpan: str) -> str:
    return f"{normalize_lookup_value(site_id)}|{normalize_lookup_value(mpan)}"


def normalize_lookup_value(value: str) -> str:
    return normalize_display_value(value).lower()


def _validate_upload_type(upload_type: str) -> None:
    if upload_type not in TEMPLATE_HEADERS:
        raise MatchingModelError("Unknown upload type.")


def _validate_file_extension(filename: str) -> None:
    if not ALLOWED_FILE_PATTERN.search(filename):
        raise MatchingModelError(
            "File format not supported. Please upload an .xlsx or .csv file."
        )


def cell_at(row: list[str], index: int) -> str:
    return row[index] if index < len(row) else ""


def decode_text(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue

    return content.decode("utf-8", errors="replace")


def now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
