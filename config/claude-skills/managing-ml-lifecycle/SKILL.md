# Managing ML Lifecycle

## Overview
This skill covers MLOps best practices for managing the full machine learning lifecycle from experimentation to production.

## ML Lifecycle Stages
```
Data → Feature Engineering → Training → Evaluation → Deployment → Monitoring
  ↑                                                                    │
  └────────────────────── Feedback Loop ──────────────────────────────┘
```

## Core Principles

1. **Reproducibility** - Every experiment must be reproducible
2. **Version Everything** - Code, data, models, configs
3. **Automate** - Training, testing, deployment pipelines
4. **Monitor** - Track model performance and data drift
5. **Iterate Fast** - Rapid experimentation cycles

## Experiment Tracking

### MLflow
```python
import mlflow

mlflow.set_tracking_uri("http://localhost:5000")
mlflow.set_experiment("my-experiment")

with mlflow.start_run():
    # Log parameters
    mlflow.log_param("learning_rate", 0.01)
    mlflow.log_param("epochs", 100)
    mlflow.log_param("model_type", "transformer")

    # Train model
    model = train_model(lr=0.01, epochs=100)

    # Log metrics
    mlflow.log_metric("accuracy", 0.95)
    mlflow.log_metric("loss", 0.05)
    mlflow.log_metric("f1_score", 0.94)

    # Log model
    mlflow.sklearn.log_model(model, "model")

    # Log artifacts
    mlflow.log_artifact("confusion_matrix.png")
    mlflow.log_artifact("config.yaml")
```

### Model Registry
```python
# Register model
mlflow.register_model(
    f"runs:/{run_id}/model",
    "my-model"
)

# Transition to production
client = mlflow.tracking.MlflowClient()
client.transition_model_version_stage(
    name="my-model",
    version=1,
    stage="Production"
)

# Load production model
model = mlflow.pyfunc.load_model("models:/my-model/Production")
```

### Weights & Biases
```python
import wandb

wandb.init(
    project="my-project",
    config={
        "learning_rate": 0.01,
        "epochs": 100,
        "architecture": "transformer"
    }
)

for epoch in range(100):
    loss, accuracy = train_epoch()
    wandb.log({
        "loss": loss,
        "accuracy": accuracy,
        "epoch": epoch
    })

wandb.finish()
```

## Training Pipelines

### Prefect Pipeline
```python
from prefect import flow, task

@task
def prepare_data():
    return X_train, X_test, y_train, y_test

@task
def train_model(X_train, y_train, params):
    model = Model(**params)
    model.fit(X_train, y_train)
    return model

@task
def evaluate_model(model, X_test, y_test):
    predictions = model.predict(X_test)
    return {
        "accuracy": accuracy_score(y_test, predictions),
        "f1": f1_score(y_test, predictions)
    }

@task
def deploy_model(model, metrics):
    if metrics["accuracy"] > 0.9:
        mlflow.register_model(model, "production")

@flow(name="training-pipeline")
def training_pipeline():
    X_train, X_test, y_train, y_test = prepare_data()
    model = train_model(X_train, y_train, {"lr": 0.01})
    metrics = evaluate_model(model, X_test, y_test)
    deploy_model(model, metrics)
```

## Model Serving

### FastAPI
```python
from fastapi import FastAPI
import mlflow

app = FastAPI()
model = mlflow.pyfunc.load_model("models:/my-model/Production")

@app.post("/predict")
async def predict(data: PredictRequest):
    prediction = model.predict(data.features)
    return {"prediction": prediction.tolist()}

@app.get("/health")
async def health():
    return {"status": "healthy", "model_version": model.metadata.run_id}
```

### Triton Inference Server
```
models/
└── my_model/
    ├── config.pbtxt
    └── 1/
        └── model.onnx
```

```bash
docker run --gpus=1 -p8000:8000 -p8001:8001 \
  -v $(pwd)/models:/models \
  nvcr.io/nvidia/tritonserver:23.10-py3 \
  tritonserver --model-repository=/models
```

## Data Drift Detection

### Evidently
```python
from evidently import ColumnMapping
from evidently.report import Report
from evidently.metrics import DataDriftPreset

report = Report(metrics=[DataDriftPreset()])

report.run(
    reference_data=training_data,
    current_data=production_data,
    column_mapping=ColumnMapping()
)

report.save_html("drift_report.html")

# Check for drift
if report.as_dict()['metrics'][0]['result']['dataset_drift']:
    trigger_retraining()
```

## Model Monitoring

### Performance Tracking
```python
def log_prediction(input_data, prediction, actual=None):
    record = {
        "timestamp": datetime.now(),
        "input_hash": hash(str(input_data)),
        "prediction": prediction,
        "actual": actual,
        "model_version": current_model_version
    }
    monitoring_db.insert(record)

def calculate_metrics(window_hours=24):
    records = monitoring_db.query_recent(hours=window_hours)
    labeled = [r for r in records if r["actual"] is not None]

    if labeled:
        accuracy = sum(r["prediction"] == r["actual"] for r in labeled) / len(labeled)
        return {"accuracy": accuracy, "sample_size": len(labeled)}
    return None
```

## Feature Stores

### Feast
```python
from feast import FeatureStore

store = FeatureStore(repo_path="feature_repo")

# Get historical features for training
training_df = store.get_historical_features(
    entity_df=entity_df,
    features=[
        "user_features:age",
        "user_features:total_purchases",
        "product_features:category",
    ]
).to_df()

# Get online features for inference
features = store.get_online_features(
    features=[
        "user_features:age",
        "user_features:total_purchases",
    ],
    entity_rows=[{"user_id": 123}]
).to_dict()
```

## CI/CD for ML

### GitHub Actions
```yaml
name: ML Pipeline

on:
  push:
    paths:
      - 'models/**'
      - 'training/**'

jobs:
  train:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: pip install -r requirements.txt

      - name: Train model
        run: python training/train.py

      - name: Evaluate model
        run: python training/evaluate.py

      - name: Register model
        if: success()
        run: python training/register.py

  deploy:
    needs: train
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to production
        run: python deployment/deploy.py
```

## LLM/RAG Operations

### Vector Store Management
```python
from langchain.vectorstores import Pinecone
from langchain.embeddings import OpenAIEmbeddings

embeddings = OpenAIEmbeddings()

# Index documents
vectorstore = Pinecone.from_documents(
    documents,
    embeddings,
    index_name="my-index"
)

# Query
results = vectorstore.similarity_search(query, k=5)
```

### RAG Evaluation
```python
from ragas import evaluate
from ragas.metrics import faithfulness, answer_relevancy

result = evaluate(
    dataset,
    metrics=[faithfulness, answer_relevancy]
)
print(result)  # {"faithfulness": 0.85, "answer_relevancy": 0.92}
```

## MLOps Checklist

- [ ] Experiment tracking configured
- [ ] Model versioning in place
- [ ] Training pipeline automated
- [ ] Model registry set up
- [ ] Serving infrastructure ready
- [ ] Monitoring and alerting configured
- [ ] Data versioning implemented
- [ ] CI/CD for models configured
- [ ] Drift detection enabled
- [ ] Rollback strategy defined
