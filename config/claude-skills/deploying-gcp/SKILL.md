# Deploying to Google Cloud Platform

## Overview
This skill covers deploying AI/ML applications to GCP using best practices for serverless, containers, and Vertex AI services.

## GCP Services for AI Applications

### Compute Options
1. **Cloud Run** - Serverless containers (up to 60 min, 32GB memory)
2. **Cloud Functions** - Serverless functions (2nd gen recommended)
3. **GKE** - Kubernetes with GPU support
4. **Compute Engine** - VMs with GPUs

### AI/ML Services
1. **Vertex AI** - Full ML platform with model garden
2. **Gemini API** - Google's foundation models
3. **Document AI** - Document processing
4. **Natural Language AI** - NLP analysis
5. **Vision AI** - Image analysis

### Data & Storage
1. **Cloud Storage (GCS)** - Object storage
2. **BigQuery** - Analytics data warehouse with vector search
3. **Cloud SQL** - Managed PostgreSQL/MySQL
4. **Firestore** - NoSQL document database
5. **AlloyDB** - PostgreSQL compatible with pgvector
6. **Memorystore** - Redis/Memcached

## Deployment Patterns

### Cloud Run Service
```yaml
# service.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: ai-app
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: '1'
        autoscaling.knative.dev/maxScale: '10'
        run.googleapis.com/cpu-throttling: 'false'
    spec:
      containerConcurrency: 80
      timeoutSeconds: 300
      containers:
        - image: gcr.io/PROJECT/ai-app:latest
          ports:
            - containerPort: 8080
          resources:
            limits:
              cpu: '2'
              memory: 4Gi
          env:
            - name: PROJECT_ID
              value: my-project
          envFrom:
            - secretRef:
                name: app-secrets
```

### Deploy Commands
```bash
# Build and push
gcloud builds submit --tag gcr.io/PROJECT/ai-app

# Deploy to Cloud Run
gcloud run deploy ai-app \
  --image gcr.io/PROJECT/ai-app \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 10 \
  --set-env-vars "PROJECT_ID=my-project"
```

### Vertex AI Integration
```python
from google.cloud import aiplatform
from vertexai.generative_models import GenerativeModel

aiplatform.init(project="my-project", location="us-central1")

# Using Gemini
model = GenerativeModel("gemini-1.5-pro")

def generate_response(prompt: str) -> str:
    response = model.generate_content(prompt)
    return response.text

# Streaming
def generate_stream(prompt: str):
    responses = model.generate_content(prompt, stream=True)
    for response in responses:
        yield response.text

# Using Claude via Vertex AI Model Garden
from anthropic import AnthropicVertex

client = AnthropicVertex(region="us-east5", project_id="my-project")

response = client.messages.create(
    model="claude-3-5-sonnet@20240620",
    max_tokens=4096,
    messages=[{"role": "user", "content": prompt}]
)
```

### BigQuery Vector Search
```sql
-- Create table with embeddings
CREATE TABLE `project.dataset.documents` (
  id STRING,
  content STRING,
  embedding ARRAY<FLOAT64>
);

-- Vector search
SELECT
  id,
  content,
  ML.DISTANCE(embedding, @query_embedding, 'COSINE') as distance
FROM `project.dataset.documents`
ORDER BY distance
LIMIT 10;
```

## Infrastructure as Code

### Terraform
```hcl
# Cloud Run service
resource "google_cloud_run_v2_service" "ai_app" {
  name     = "ai-app"
  location = "us-central1"

  template {
    containers {
      image = "gcr.io/${var.project}/ai-app:${var.tag}"

      resources {
        limits = {
          cpu    = "2"
          memory = "4Gi"
        }
      }

      env {
        name  = "PROJECT_ID"
        value = var.project
      }

      env {
        name = "API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.api_key.secret_id
            version = "latest"
          }
        }
      }
    }

    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }

    service_account = google_service_account.app.email
  }
}

# IAM
resource "google_cloud_run_service_iam_member" "public" {
  service  = google_cloud_run_v2_service.ai_app.name
  location = google_cloud_run_v2_service.ai_app.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
```

## Security Best Practices

1. **Service Accounts** - Dedicated per-service identity
2. **Secret Manager** - Store API keys and credentials
3. **VPC Connector** - Private networking
4. **Cloud Armor** - DDoS protection
5. **IAM Conditions** - Fine-grained access control

## Monitoring

### Cloud Monitoring
```python
from google.cloud import monitoring_v3

client = monitoring_v3.MetricServiceClient()
project_name = f"projects/{project_id}"

def write_metric(metric_type: str, value: float):
    series = monitoring_v3.TimeSeries()
    series.metric.type = f"custom.googleapis.com/{metric_type}"
    series.resource.type = "global"

    point = monitoring_v3.Point()
    point.value.double_value = value
    point.interval.end_time.seconds = int(time.time())
    series.points = [point]

    client.create_time_series(name=project_name, time_series=[series])

# Track LLM usage
write_metric("llm/invocations", 1)
write_metric("llm/tokens", token_count)
```

### Cloud Trace
```python
from opentelemetry import trace
from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# Setup
provider = TracerProvider()
processor = BatchSpanProcessor(CloudTraceSpanExporter())
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

tracer = trace.get_tracer(__name__)

@tracer.start_as_current_span("llm_call")
def call_llm(prompt: str):
    span = trace.get_current_span()
    span.set_attribute("prompt_length", len(prompt))
    # ... call LLM
```

## Cost Optimization

1. **Committed Use Discounts** - For predictable workloads
2. **Preemptible VMs** - For batch processing
3. **Cloud Run min-instances=0** - Scale to zero
4. **BigQuery slots** - Reserved capacity
5. **Lifecycle policies** - Archive old data

## Deployment Checklist

- [ ] Service account with least privilege
- [ ] Secrets in Secret Manager
- [ ] VPC Connector if private resources needed
- [ ] Cloud Monitoring dashboards
- [ ] Cloud Trace enabled
- [ ] Budget alerts configured
- [ ] Cloud Armor rules if public
- [ ] Multi-region for high availability
