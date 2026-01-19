# Monitoring AI/LLM Applications

## Overview
This skill covers implementing comprehensive observability for AI and LLM applications, including tracing, metrics, cost tracking, and quality monitoring.

## Three Pillars of Observability

1. **Metrics** - Quantitative measurements (latency, tokens, costs)
2. **Logs** - Structured event records
3. **Traces** - Request flow across services

## LLM-Specific Metrics

### Key Metrics to Track
| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| Latency P50/P95/P99 | Response time | P95 > 5s |
| Time to First Token | Streaming start | > 500ms |
| Tokens/Second | Throughput | < 10 tok/s |
| Input/Output Tokens | Usage tracking | Sudden spike |
| Cost per Request | Dollar amount | Budget exceeded |
| Error Rate | Failed calls | > 5% |
| Quality Score | Faithfulness/relevancy | < 0.7 |

## LLM Observability Platforms

### Helicone (Proxy-based)
```python
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["OPENAI_API_KEY"],
    base_url="https://oai.helicone.ai/v1",
    default_headers={
        "Helicone-Auth": f"Bearer {os.environ['HELICONE_API_KEY']}",
        "Helicone-Property-Session": session_id,
        "Helicone-Property-User": user_id,
    }
)

# All calls automatically traced
response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### Langfuse (Open Source)
```python
from langfuse import Langfuse
from langfuse.decorators import observe

langfuse = Langfuse()

@observe()
def my_llm_function(prompt: str):
    response = openai.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": prompt}]
    )
    return response.choices[0].message.content

# Manual tracing
trace = langfuse.trace(name="my-trace")
span = trace.span(name="llm-call")
# ... work
span.end()
trace.end()
```

### LangSmith (LangChain)
```python
import os
os.environ["LANGCHAIN_TRACING_V2"] = "true"
os.environ["LANGCHAIN_API_KEY"] = "your-key"
os.environ["LANGCHAIN_PROJECT"] = "my-project"

# All LangChain operations auto-traced
from langchain.chat_models import ChatOpenAI
llm = ChatOpenAI()
result = llm.invoke("Hello!")
```

## Custom Metrics Implementation

### Prometheus Metrics
```python
from prometheus_client import Counter, Histogram, Gauge

llm_requests = Counter(
    'llm_requests_total',
    'Total LLM requests',
    ['model', 'status']
)

llm_latency = Histogram(
    'llm_latency_seconds',
    'LLM request latency',
    ['model'],
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]
)

llm_tokens = Counter(
    'llm_tokens_total',
    'Total tokens used',
    ['model', 'type']  # input/output
)

llm_cost = Counter(
    'llm_cost_dollars',
    'Total cost in dollars',
    ['model']
)

def call_llm(prompt: str, model: str):
    with llm_latency.labels(model=model).time():
        response = openai.chat.completions.create(...)

    llm_requests.labels(model=model, status="success").inc()
    llm_tokens.labels(model=model, type="input").inc(response.usage.prompt_tokens)
    llm_tokens.labels(model=model, type="output").inc(response.usage.completion_tokens)
```

### Cost Tracking
```python
PRICING = {
    "gpt-4": {"input": 0.03, "output": 0.06},
    "gpt-4-turbo": {"input": 0.01, "output": 0.03},
    "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015},
    "claude-3-opus": {"input": 0.015, "output": 0.075},
    "claude-3-sonnet": {"input": 0.003, "output": 0.015},
    "claude-3-haiku": {"input": 0.00025, "output": 0.00125},
}

def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = PRICING.get(model, {"input": 0, "output": 0})
    return (
        (input_tokens / 1000) * pricing["input"] +
        (output_tokens / 1000) * pricing["output"]
    )
```

## Structured Logging
```python
import structlog

logger = structlog.get_logger()

def call_llm(prompt: str, user_id: str):
    log = logger.bind(user_id=user_id, model="gpt-4")
    log.info("llm_request_started", prompt_length=len(prompt))

    try:
        response = openai.chat.completions.create(...)

        log.info(
            "llm_request_completed",
            input_tokens=response.usage.prompt_tokens,
            output_tokens=response.usage.completion_tokens,
            latency_ms=response.response_ms,
            cost=calculate_cost(...),
        )
        return response

    except Exception as e:
        log.error("llm_request_failed", error=str(e))
        raise
```

## Distributed Tracing

### OpenTelemetry
```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

provider = TracerProvider()
provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint="http://jaeger:4317"))
)
trace.set_tracer_provider(provider)

tracer = trace.get_tracer(__name__)

@tracer.start_as_current_span("llm_call")
def call_llm(prompt: str):
    span = trace.get_current_span()
    span.set_attribute("llm.model", "gpt-4")
    span.set_attribute("llm.prompt_length", len(prompt))

    response = openai.chat.completions.create(...)

    span.set_attribute("llm.input_tokens", response.usage.prompt_tokens)
    span.set_attribute("llm.output_tokens", response.usage.completion_tokens)
    return response
```

## Quality Monitoring (RAG)

### RAGAS Metrics
```python
from ragas.metrics import (
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall
)
from ragas import evaluate

def evaluate_rag_response(query, answer, contexts, ground_truth):
    dataset = Dataset.from_dict({
        "question": [query],
        "answer": [answer],
        "contexts": [contexts],
        "ground_truth": [ground_truth]
    })

    result = evaluate(
        dataset,
        metrics=[
            faithfulness,
            answer_relevancy,
            context_precision,
            context_recall
        ]
    )
    return result
```

## Alerting Rules (Prometheus)
```yaml
groups:
  - name: llm_alerts
    rules:
      - alert: HighLLMLatency
        expr: histogram_quantile(0.95, llm_latency_seconds_bucket) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High LLM latency: {{ $value }}s"

      - alert: HighLLMErrorRate
        expr: >
          rate(llm_requests_total{status="error"}[5m]) /
          rate(llm_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "LLM error rate above 5%"

      - alert: HighLLMCost
        expr: increase(llm_cost_dollars[1h]) > 100
        labels:
          severity: warning
        annotations:
          summary: "High LLM cost: ${{ $value }}/hour"
```

## Dashboard Panels

### Essential Visualizations
1. **Request Volume** - Requests/second by model
2. **Latency Distribution** - P50, P95, P99 over time
3. **Token Usage** - Input vs output tokens
4. **Cost Breakdown** - Hourly/daily by model
5. **Error Rate** - Errors over time
6. **Quality Scores** - Faithfulness, relevancy trends

## Observability Checklist

- [ ] Request/response logging enabled
- [ ] Latency metrics (P50/P95/P99)
- [ ] Token usage tracked
- [ ] Cost tracking implemented
- [ ] Error rates monitored
- [ ] Distributed tracing configured
- [ ] Alerts for key thresholds
- [ ] Dashboards created
- [ ] Quality metrics (for RAG)
- [ ] User feedback collection
