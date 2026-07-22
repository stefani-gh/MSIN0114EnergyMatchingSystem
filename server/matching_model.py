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
    pass


@dataclass
class UploadedFile:
    filename: str
    content: bytes


@dataclass
class ParsedEnergyRecord:
    record_number: int
    site_id: str
    mpan: str
    date: str
    intervals: list[float]


@dataclass
class CarryForwardLot:
    source_row: dict[str, Any]
    remaining_kwh: float
    commodity_remaining: dict[str, float]


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
FIRST_INTERVAL_COLUMN_INDEX = 3
LAST_INTERVAL_COLUMN_INDEX = 50
DATE_COLUMN_INDEX = 2
ALLOWED_FILE_PATTERN = re.compile(r"\.(xlsx|csv)$", re.IGNORECASE)
EXCEL_DATE_EPOCH = datetime(1899, 12, 30, tzinfo=timezone.utc)
DAILY_TOTAL_TOLERANCE = 0.000001
UNMAPPED_COMMODITY_LABEL = "Unmapped commodity"
MATCHING_APPROACH_LABELS = {
    "carry-forward": "Carry forward (Daily)",
    "carry-forward-hourly": "Carry forward (Hourly)",
    "non-carry-forward": "Non-carry forward approach",
}


def validate_energy_file_template(file: UploadedFile, upload_type: str) -> list[str]:
    _validate_upload_type(upload_type)
    _validate_file_extension(file.filename)

    try:
        rows = read_spreadsheet_rows(file)
    except Exception as exc:
        raise MatchingModelError(
            "The file could not be read. Please reupload a valid template-based .xlsx or .csv file."
        ) from exc

    validate_template_headers(upload_type, rows[0] if rows else [])
    validation_result = validate_energy_data_rows(upload_type, rows)

    if validation_result["errors"]:
        raise MatchingModelError(
            format_file_validation_errors(upload_type, validation_result["errors"])
        )

    return validation_result["empty_cells"]


def get_generation_sources(file: UploadedFile) -> list[dict[str, str]]:
    generation_records = parse_energy_file(file, "generation")
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
) -> dict[str, Any]:
    normalized_matching_approach = normalize_matching_approach(matching_approach)
    consumption_records = parse_energy_file(consumption_file, "consumption")
    generation_records = parse_energy_file(generation_file, "generation")

    if not consumption_records or not generation_records:
        raise MatchingModelError(
            "Both files must contain at least one data row below the template header."
        )

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
    matching_record_pairs = (
        build_carry_forward_matching_record_pairs(
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
        results = build_carry_forward_matching_results(
            matching_record_pairs,
            customer_allocation_map,
            generation_records_by_date,
            generator_commodity_map,
            commodity_matched_totals,
        )
    elif normalized_matching_approach == "carry-forward-hourly":
        results = build_hourly_carry_forward_matching_results(
            matching_record_pairs,
            customer_allocation_map,
            generation_records_by_date,
            generator_commodity_map,
            commodity_matched_totals,
        )
    else:
        results = build_non_carry_forward_matching_results(
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
        "commodityEnergyResults": build_commodity_energy_results(
            commodity_generation_totals,
            commodity_matched_totals,
        ),
        "results": results,
        "summary": summary,
    }


def build_non_carry_forward_matching_results(
    matching_record_pairs: list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]],
    customer_allocation_map: dict[str, dict[str, Any]],
    generation_records_by_date: dict[str, list[ParsedEnergyRecord]],
    generator_commodity_map: dict[str, str],
    commodity_matched_totals: dict[tuple[str, str, str], dict[str, Any]],
) -> list[dict[str, Any]]:
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

        for interval_index, interval in enumerate(HALF_HOURLY_INTERVALS):
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


def build_carry_forward_matching_results(
    matching_record_pairs: list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]],
    customer_allocation_map: dict[str, dict[str, Any]],
    generation_records_by_date: dict[str, list[ParsedEnergyRecord]],
    generator_commodity_map: dict[str, str],
    commodity_matched_totals: dict[tuple[str, str, str], dict[str, Any]],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    carry_pools: dict[str, list[CarryForwardLot]] = {}
    active_date: str | None = None

    for record_index, (consumption_record, generation_record) in enumerate(
        matching_record_pairs
    ):
        if active_date is not None and consumption_record.date != active_date:
            assign_carry_forward_excess_generation(carry_pools)
            carry_pools = {}

        active_date = consumption_record.date
        customer_allocation, share_percentage, allocation_source = (
            get_customer_allocation_context(
                consumption_record,
                customer_allocation_map,
            )
        )
        carry_key = get_energy_record_lookup_key(
            consumption_record.site_id,
            consumption_record.mpan,
        )
        carry_pool = carry_pools.setdefault(carry_key, [])

        for interval_index, interval in enumerate(HALF_HOURLY_INTERVALS):
            consumption_kwh = consumption_record.intervals[interval_index]
            generation_kwh = generation_record.intervals[interval_index]
            allocated_generation_kwh = generation_kwh * (share_percentage / 100)
            row = create_matching_result_row(
                record_index,
                interval,
                consumption_record,
                generation_record,
                consumption_kwh,
                generation_kwh,
                allocated_generation_kwh,
                0.0,
                consumption_kwh,
                0.0,
                share_percentage,
                allocation_source,
                customer_allocation,
            )

            if allocated_generation_kwh > 0:
                carry_pool.append(
                    CarryForwardLot(
                        source_row=row,
                        remaining_kwh=allocated_generation_kwh,
                        commodity_remaining=get_allocated_generation_by_commodity(
                            generation_records_by_date.get(
                                generation_record.date,
                                [],
                            ),
                            interval_index,
                            allocated_generation_kwh,
                            generator_commodity_map,
                        ),
                    )
                )

            matched_energy_kwh = consume_carry_forward_generation(
                carry_pool,
                consumption_kwh,
                row["date"],
                interval,
                commodity_matched_totals,
                bool(generator_commodity_map),
            )
            row["matchedEnergyKwh"] = matched_energy_kwh
            row["unmatchedConsumptionKwh"] = max(
                consumption_kwh - matched_energy_kwh,
                0.0,
            )
            row["consumptionMatchingPercentage"] = calculate_matching_percentage(
                consumption_kwh,
                matched_energy_kwh,
            )
            results.append(row)

    assign_carry_forward_excess_generation(carry_pools)

    return results


def build_hourly_carry_forward_matching_results(
    matching_record_pairs: list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]],
    customer_allocation_map: dict[str, dict[str, Any]],
    generation_records_by_date: dict[str, list[ParsedEnergyRecord]],
    generator_commodity_map: dict[str, str],
    commodity_matched_totals: dict[tuple[str, str, str], dict[str, Any]],
) -> list[dict[str, Any]]:
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
        carry_pool: list[CarryForwardLot] = []

        for interval_index, interval in enumerate(HALF_HOURLY_INTERVALS):
            consumption_kwh = consumption_record.intervals[interval_index]
            generation_kwh = generation_record.intervals[interval_index]
            allocated_generation_kwh = generation_kwh * (share_percentage / 100)
            row = create_matching_result_row(
                record_index,
                interval,
                consumption_record,
                generation_record,
                consumption_kwh,
                generation_kwh,
                allocated_generation_kwh,
                0.0,
                consumption_kwh,
                0.0,
                share_percentage,
                allocation_source,
                customer_allocation,
            )

            if allocated_generation_kwh > 0:
                carry_pool.append(
                    CarryForwardLot(
                        source_row=row,
                        remaining_kwh=allocated_generation_kwh,
                        commodity_remaining=get_allocated_generation_by_commodity(
                            generation_records_by_date.get(
                                generation_record.date,
                                [],
                            ),
                            interval_index,
                            allocated_generation_kwh,
                            generator_commodity_map,
                        ),
                    )
                )

            matched_energy_kwh = consume_carry_forward_generation(
                carry_pool,
                consumption_kwh,
                row["date"],
                interval,
                commodity_matched_totals,
                bool(generator_commodity_map),
            )
            row["matchedEnergyKwh"] = matched_energy_kwh
            row["unmatchedConsumptionKwh"] = max(
                consumption_kwh - matched_energy_kwh,
                0.0,
            )
            row["consumptionMatchingPercentage"] = calculate_matching_percentage(
                consumption_kwh,
                matched_energy_kwh,
            )
            results.append(row)

            if interval_index % 2 == 1:
                assign_carry_forward_excess_generation(
                    {"hourly-carry-pool": carry_pool}
                )
                carry_pool = []

    return results


def get_customer_allocation_context(
    consumption_record: ParsedEnergyRecord,
    customer_allocation_map: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any] | None, float, str]:
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
    return (
        0.0
        if consumption_kwh == 0
        else min((matched_energy_kwh / consumption_kwh) * 100, 100)
    )


def get_allocated_generation_by_commodity(
    source_generation_records: list[ParsedEnergyRecord],
    interval_index: int,
    allocated_generation_kwh: float,
    generator_commodity_map: dict[str, str],
) -> dict[str, float]:
    if not generator_commodity_map or allocated_generation_kwh <= 0:
        return {}

    total_generation_kwh = sum(
        record.intervals[interval_index] for record in source_generation_records
    )

    if total_generation_kwh <= 0:
        return {}

    commodity_allocations: dict[str, float] = {}

    for generation_record in source_generation_records:
        source_generation_kwh = generation_record.intervals[interval_index]

        if source_generation_kwh == 0:
            continue

        commodity = get_generator_commodity(
            generation_record,
            generator_commodity_map,
        )
        commodity_allocations[commodity] = commodity_allocations.get(
            commodity,
            0.0,
        ) + allocated_generation_kwh * (source_generation_kwh / total_generation_kwh)

    return commodity_allocations


def consume_carry_forward_generation(
    carry_pool: list[CarryForwardLot],
    consumption_kwh: float,
    consumption_date: str,
    interval: str,
    commodity_matched_totals: dict[tuple[str, str, str], dict[str, Any]],
    track_commodities: bool,
) -> float:
    remaining_consumption_kwh = consumption_kwh
    matched_energy_kwh = 0.0

    while remaining_consumption_kwh > 0 and carry_pool:
        lot = carry_pool[0]
        consumed_kwh = min(remaining_consumption_kwh, lot.remaining_kwh)

        if consumed_kwh <= 0:
            carry_pool.pop(0)
            continue

        consume_commodity_generation(
            lot,
            consumed_kwh,
            consumption_date,
            interval,
            commodity_matched_totals,
            track_commodities,
        )
        lot.remaining_kwh -= consumed_kwh
        matched_energy_kwh += consumed_kwh
        remaining_consumption_kwh -= consumed_kwh

        if lot.remaining_kwh <= DAILY_TOTAL_TOLERANCE:
            carry_pool.pop(0)

    return matched_energy_kwh


def consume_commodity_generation(
    lot: CarryForwardLot,
    consumed_kwh: float,
    consumption_date: str,
    interval: str,
    commodity_matched_totals: dict[tuple[str, str, str], dict[str, Any]],
    track_commodities: bool,
) -> None:
    if not track_commodities or not lot.commodity_remaining or lot.remaining_kwh <= 0:
        return

    consumed_ratio = consumed_kwh / lot.remaining_kwh

    for commodity, commodity_kwh in list(lot.commodity_remaining.items()):
        consumed_commodity_kwh = commodity_kwh * consumed_ratio

        if consumed_commodity_kwh <= 0:
            continue

        current_total = get_or_create_commodity_energy_total(
            commodity_matched_totals,
            commodity,
            consumption_date,
            interval,
        )
        current_total["matchedEnergyKwh"] += consumed_commodity_kwh
        lot.commodity_remaining[commodity] = max(
            commodity_kwh - consumed_commodity_kwh,
            0.0,
        )


def assign_carry_forward_excess_generation(
    carry_pools: dict[str, list[CarryForwardLot]],
) -> None:
    for carry_pool in carry_pools.values():
        for lot in carry_pool:
            if lot.remaining_kwh <= DAILY_TOTAL_TOLERANCE:
                continue

            lot.source_row["excessGenerationKwh"] += lot.remaining_kwh


def build_matching_summary(results: list[dict[str, Any]]) -> dict[str, float]:
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
    allocated_generation_kwh = total_generation_kwh * (share_percentage / 100)
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


def parse_energy_file(file: UploadedFile, upload_type: str) -> list[ParsedEnergyRecord]:
    _validate_upload_type(upload_type)
    _validate_file_extension(file.filename)

    rows = read_spreadsheet_rows(file)
    validate_template_headers(upload_type, rows[0] if rows else [])
    validation_result = validate_energy_data_rows(upload_type, rows)

    if validation_result["errors"]:
        raise MatchingModelError(
            format_file_validation_errors(upload_type, validation_result["errors"])
        )

    daily_total_column_index = get_daily_total_column_index(rows[0] if rows else [])

    records: list[ParsedEnergyRecord] = []
    for row_index, row in enumerate(rows[1:], start=2):
        record = parse_energy_record(
            row,
            row_index,
            upload_type,
            daily_total_column_index,
        )
        if record is not None:
            records.append(record)

    return records


def parse_energy_record(
    row: list[str],
    record_number: int,
    upload_type: str,
    daily_total_column_index: int | None,
) -> ParsedEnergyRecord | None:
    has_data = any(cell.strip() for cell in row)

    if not has_data:
        return None

    date = normalize_energy_date_value(cell_at(row, DATE_COLUMN_INDEX))

    if not date:
        raise MatchingModelError(
            f"The {get_upload_type_label(upload_type)} file contains empty value in {get_cell_reference(record_number, DATE_COLUMN_INDEX)}. Date is required."
        )

    interval_cells = row[FIRST_INTERVAL_COLUMN_INDEX : LAST_INTERVAL_COLUMN_INDEX + 1]
    intervals = [
        parse_energy_value(
            interval_cells[index] if index < len(interval_cells) else "",
            record_number,
            FIRST_INTERVAL_COLUMN_INDEX + index + 1,
        )
        for index in range(len(HALF_HOURLY_INTERVALS))
    ]
    if daily_total_column_index is not None:
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
    )


def parse_energy_value(value: str, record_number: int, column_number: int) -> float:
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


def read_spreadsheet_rows(file: UploadedFile) -> list[list[str]]:
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
    expected_headers = TEMPLATE_HEADERS[upload_type]
    normalized_uploaded_headers = [normalize_header_value(header) for header in uploaded_headers]
    normalized_expected_headers = [normalize_header_value(header) for header in expected_headers]
    expected_template = "consumption" if upload_type == "consumption" else "generation"

    if len(normalized_uploaded_headers) < len(normalized_expected_headers):
        raise MatchingModelError(
            f"This file does not match the {expected_template} template. Please reupload using the correct template."
        )

    for index, expected_header in enumerate(normalized_expected_headers):
        if normalized_uploaded_headers[index] != expected_header:
            raise MatchingModelError(
                f'This file does not match the {expected_template} template. Column {index + 1} should be "{expected_headers[index]}". Please reupload using the correct template.'
            )


def validate_energy_data_rows(
    upload_type: str,
    rows: list[list[str]],
) -> dict[str, list[str]]:
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

    record_rows_by_key: dict[tuple[str, str], list[int]] = {}

    for row_number, row in enumerate(rows[1:], start=2):
        if not any(cell.strip() for cell in row):
            continue

        date = normalize_energy_date_value(cell_at(row, DATE_COLUMN_INDEX))

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
            if not cell_at(row, column_index).strip():
                empty_cells.append(get_cell_reference(row_number, column_index))

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
    record_pairs: list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]] = []
    generation_records_by_date = build_generation_records_by_date(generation_records)
    consumption_dates = set()

    for consumption_record in consumption_records:
        consumption_dates.add(consumption_record.date)
        generation_record = generation_records_by_date.get(consumption_record.date)

        if generation_record is None:
            generation_record = create_zero_energy_record(consumption_record)

        record_pairs.append((consumption_record, generation_record))

    for generation_record in generation_records_by_date.values():
        if generation_record.date in consumption_dates:
            continue

        record_pairs.append(
            (create_zero_energy_record(generation_record), generation_record)
        )

    return record_pairs


def build_carry_forward_matching_record_pairs(
    consumption_records: list[ParsedEnergyRecord],
    generation_records: list[ParsedEnergyRecord],
) -> list[tuple[ParsedEnergyRecord, ParsedEnergyRecord]]:
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
                record_pairs.append(
                    (
                        consumption_record,
                        generation_record
                        if generation_record is not None
                        else create_zero_energy_record(consumption_record),
                    )
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
    first_record = records[0]

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
            sum(record.intervals[index] for record in records)
            for index in range(len(HALF_HOURLY_INTERVALS))
        ],
    )


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
        intervals=[0.0] * len(HALF_HOURLY_INTERVALS),
    )


def create_zero_consumption_record_for_date(
    source_record: ParsedEnergyRecord,
    date: str,
    record_number: int,
) -> ParsedEnergyRecord:
    return ParsedEnergyRecord(
        record_number=record_number,
        site_id=source_record.site_id,
        mpan=source_record.mpan,
        date=date,
        intervals=[0.0] * len(HALF_HOURLY_INTERVALS),
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


def get_column_index(cell_reference: str) -> int:
    match = re.match(r"([A-Z]+)", cell_reference)

    if not match:
        return -1

    column_number = 0
    for character in match.group(1):
        column_number = column_number * 26 + ord(character) - 64

    return column_number - 1


def parse_customer_allocations(raw_value: str) -> list[dict[str, Any]]:
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

        for interval_index, interval in enumerate(HALF_HOURLY_INTERVALS):
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
        record.intervals[interval_index] for record in source_generation_records
    )

    if total_generation_kwh <= 0:
        return

    for generation_record in source_generation_records:
        source_generation_kwh = generation_record.intervals[interval_index]

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
