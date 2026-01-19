# Processing Data

## Overview
This skill covers data engineering best practices for ETL/ELT pipelines, data transformations, and data quality.

## Core Principles

1. **Data Quality First** - Validate at every stage
2. **Idempotency** - Pipelines must be safely re-runnable
3. **Incremental Processing** - Process only what changed
4. **Schema Evolution** - Plan for changes
5. **Observability** - Monitor freshness and quality

## Pipeline Patterns

### Batch ETL
```
Source DB → Extract → Transform → Load → Data Warehouse
                ↓
         Staging Area
```

### Modern ELT
```
Sources → Raw Layer → Transform in DW → Data Marts
              ↓
         Data Lake (S3/GCS)
```

### Real-time Streaming
```
Events → Kafka → Stream Processing → Data Lake
                       ↓
              Real-time Analytics
```

## SQL Transformations

### BigQuery
```sql
-- Partitioned table
CREATE TABLE `project.dataset.events`
PARTITION BY DATE(event_time)
CLUSTER BY user_id
AS SELECT * FROM `project.dataset.raw_events`;

-- Incremental load (MERGE)
MERGE `project.dataset.users` AS target
USING `project.dataset.staging_users` AS source
ON target.id = source.id
WHEN MATCHED THEN
  UPDATE SET
    name = source.name,
    updated_at = CURRENT_TIMESTAMP()
WHEN NOT MATCHED THEN
  INSERT (id, name, created_at, updated_at)
  VALUES (source.id, source.name, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP());

-- Window functions
SELECT
  user_id,
  event_time,
  LAG(event_time) OVER (PARTITION BY user_id ORDER BY event_time) as prev_event,
  ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY event_time) as event_seq
FROM `project.dataset.events`;
```

### PostgreSQL
```sql
-- Upsert pattern
INSERT INTO users (id, name, email, updated_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  updated_at = NOW();

-- CTEs for complex transformations
WITH daily_metrics AS (
  SELECT
    date_trunc('day', created_at) as day,
    COUNT(*) as events,
    COUNT(DISTINCT user_id) as users
  FROM events
  WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY 1
),
rolling_avg AS (
  SELECT
    day,
    events,
    AVG(events) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as rolling_7d
  FROM daily_metrics
)
SELECT * FROM rolling_avg ORDER BY day;
```

## Python ETL

### Pandas
```python
import pandas as pd
from sqlalchemy import create_engine

def extract(source_uri: str, last_run: datetime) -> pd.DataFrame:
    engine = create_engine(source_uri)
    return pd.read_sql(
        "SELECT * FROM raw_data WHERE updated_at > %s",
        engine,
        params=[last_run]
    )

def transform(df: pd.DataFrame) -> pd.DataFrame:
    return (
        df
        .dropna(subset=['required_field'])
        .assign(
            created_date=lambda x: pd.to_datetime(x['created_at']).dt.date,
            amount_usd=lambda x: x['amount'] * x['exchange_rate']
        )
        .drop_duplicates(subset=['id'], keep='last')
    )

def load(df: pd.DataFrame, target_uri: str):
    engine = create_engine(target_uri)
    df.to_sql('processed_data', engine, if_exists='append', index=False)

def run_pipeline():
    raw = extract(SOURCE_URI, last_run_time)
    processed = transform(raw)
    load(processed, TARGET_URI)
```

### Polars (High Performance)
```python
import polars as pl

def process_large_file(path: str) -> pl.DataFrame:
    return (
        pl.scan_parquet(path)
        .filter(pl.col("status") == "active")
        .group_by("category")
        .agg([
            pl.count().alias("count"),
            pl.col("amount").sum().alias("total"),
            pl.col("amount").mean().alias("avg")
        ])
        .sort("total", descending=True)
        .collect()
    )
```

## Data Validation

### Great Expectations
```python
import great_expectations as gx

context = gx.get_context()

validator = context.get_validator(
    batch_request=batch_request,
    expectation_suite_name="my_suite"
)

# Define expectations
validator.expect_column_values_to_not_be_null("user_id")
validator.expect_column_values_to_be_unique("user_id")
validator.expect_column_values_to_be_between("age", min_value=0, max_value=120)
validator.expect_column_values_to_match_regex("email", r"^[\w\.-]+@[\w\.-]+\.\w+$")

# Run validation
results = validator.validate()
if not results.success:
    raise DataQualityError(f"Validation failed: {results}")
```

### dbt Tests
```yaml
# schema.yml
version: 2

models:
  - name: users
    columns:
      - name: id
        tests:
          - unique
          - not_null
      - name: email
        tests:
          - unique
          - not_null
      - name: created_at
        tests:
          - not_null
          - dbt_utils.expression_is_true:
              expression: "created_at <= current_timestamp()"

  - name: orders
    tests:
      - dbt_utils.unique_combination_of_columns:
          combination_of_columns:
            - order_id
            - line_item_id
```

## Orchestration

### Prefect
```python
from prefect import flow, task
from prefect.tasks import task_input_hash
from datetime import timedelta

@task(cache_key_fn=task_input_hash, cache_expiration=timedelta(hours=1))
def extract_data(source: str) -> pd.DataFrame:
    return pd.read_sql(...)

@task
def transform_data(df: pd.DataFrame) -> pd.DataFrame:
    return df.pipe(clean).pipe(enrich)

@task
def load_data(df: pd.DataFrame, target: str):
    df.to_sql(target, engine, if_exists='append')

@flow(name="daily-etl")
def daily_etl():
    raw = extract_data("source_table")
    transformed = transform_data(raw)
    load_data(transformed, "target_table")

if __name__ == "__main__":
    daily_etl.serve(
        name="daily-etl-deployment",
        cron="0 2 * * *"  # 2 AM daily
    )
```

### Airflow DAG
```python
from airflow import DAG
from airflow.operators.python import PythonOperator
from datetime import datetime, timedelta

default_args = {
    'owner': 'data-team',
    'retries': 3,
    'retry_delay': timedelta(minutes=5),
}

with DAG(
    'daily_etl',
    default_args=default_args,
    schedule_interval='0 2 * * *',
    start_date=datetime(2024, 1, 1),
    catchup=False,
) as dag:
    extract = PythonOperator(task_id='extract', python_callable=extract_fn)
    transform = PythonOperator(task_id='transform', python_callable=transform_fn)
    load = PythonOperator(task_id='load', python_callable=load_fn)

    extract >> transform >> load
```

## Data Quality Monitoring

### Freshness Checks
```sql
SELECT
  table_name,
  MAX(updated_at) as last_update,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(updated_at), HOUR) as hours_stale
FROM `project.dataset.INFORMATION_SCHEMA.PARTITIONS`
GROUP BY table_name
HAVING hours_stale > 24;
```

### Row Count Anomalies
```python
def check_row_counts():
    current = get_table_count("events", date.today())
    avg = get_average_count("events", days=30)

    if current < avg * 0.5:
        alert(f"Row count {current} is 50% below average {avg}")
    elif current > avg * 2:
        alert(f"Row count {current} is 2x above average {avg}")
```

## Data Engineering Checklist

- [ ] Schema documented
- [ ] Data validation in place
- [ ] Pipeline is idempotent
- [ ] Error handling implemented
- [ ] Monitoring configured
- [ ] Freshness alerts set up
- [ ] Row count monitoring
- [ ] Schema evolution planned
- [ ] Backfill strategy defined
- [ ] Data lineage tracked
