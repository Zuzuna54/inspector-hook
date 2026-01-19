# Deploying to Microsoft Azure

## Overview
This skill covers deploying AI/ML applications to Azure using best practices for serverless, containers, and Azure AI services.

## Azure Services for AI Applications

### Compute Options
1. **Azure Functions** - Serverless functions
2. **Container Apps** - Serverless containers
3. **App Service** - Web apps and APIs
4. **AKS** - Kubernetes with GPU nodes

### AI/ML Services
1. **Azure OpenAI** - GPT-4, Claude (via partnerships)
2. **Azure AI Services** - Cognitive Services suite
3. **Azure Machine Learning** - Full ML platform
4. **Document Intelligence** - Document processing
5. **AI Search** - Vector search capabilities

### Data & Storage
1. **Blob Storage** - Object storage
2. **Cosmos DB** - Multi-model NoSQL with vector search
3. **Azure SQL** - Managed SQL Server
4. **Azure Database for PostgreSQL** - With pgvector
5. **Azure Cache for Redis** - Caching layer

## Deployment Patterns

### Container Apps
```yaml
# container-app.yaml
properties:
  managedEnvironmentId: /subscriptions/.../managedEnvironments/my-env
  configuration:
    ingress:
      external: true
      targetPort: 8080
      traffic:
        - latestRevision: true
          weight: 100
    secrets:
      - name: api-key
        keyVaultUrl: https://my-vault.vault.azure.net/secrets/api-key
  template:
    containers:
      - name: ai-app
        image: myregistry.azurecr.io/ai-app:latest
        resources:
          cpu: 2
          memory: 4Gi
        env:
          - name: AZURE_OPENAI_ENDPOINT
            value: https://my-openai.openai.azure.com/
          - name: AZURE_OPENAI_KEY
            secretRef: api-key
    scale:
      minReplicas: 1
      maxReplicas: 10
      rules:
        - name: http-scaling
          http:
            metadata:
              concurrentRequests: '100'
```

### Deploy Commands
```bash
# Create Container App
az containerapp create \
  --name ai-app \
  --resource-group my-rg \
  --environment my-env \
  --image myregistry.azurecr.io/ai-app:latest \
  --target-port 8080 \
  --ingress external \
  --cpu 2 \
  --memory 4Gi \
  --min-replicas 1 \
  --max-replicas 10

# Update with new image
az containerapp update \
  --name ai-app \
  --resource-group my-rg \
  --image myregistry.azurecr.io/ai-app:v2
```

### Azure OpenAI Integration
```python
from openai import AzureOpenAI

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2024-02-01",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

def generate_response(prompt: str) -> str:
    response = client.chat.completions.create(
        model="gpt-4",  # deployment name
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096
    )
    return response.choices[0].message.content

# Streaming
def generate_stream(prompt: str):
    response = client.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "user", "content": prompt}],
        stream=True
    )
    for chunk in response:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
```

### Cosmos DB Vector Search
```python
from azure.cosmos import CosmosClient

client = CosmosClient(endpoint, credential)
database = client.get_database_client("my-db")
container = database.get_container_client("documents")

# Vector search query
def vector_search(embedding: list, top_k: int = 10):
    query = """
    SELECT TOP @top_k
        c.id, c.content,
        VectorDistance(c.embedding, @embedding) AS score
    FROM c
    ORDER BY VectorDistance(c.embedding, @embedding)
    """
    return list(container.query_items(
        query=query,
        parameters=[
            {"name": "@top_k", "value": top_k},
            {"name": "@embedding", "value": embedding}
        ]
    ))
```

## Infrastructure as Code

### Bicep
```bicep
// main.bicep
param location string = resourceGroup().location
param appName string = 'ai-app'

// Container Registry
resource acr 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' = {
  name: '${appName}registry'
  location: location
  sku: {
    name: 'Basic'
  }
}

// Container App Environment
resource env 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: '${appName}-env'
  location: location
  properties: {
    zoneRedundant: true
  }
}

// Container App
resource app 'Microsoft.App/containerApps@2023-05-01' = {
  name: appName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
      }
    }
    template: {
      containers: [
        {
          name: appName
          image: '${acr.properties.loginServer}/${appName}:latest'
          resources: {
            cpu: json('2')
            memory: '4Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 10
      }
    }
  }
}

// Azure OpenAI
resource openai 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: '${appName}-openai'
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: '${appName}-openai'
  }
}
```

### Terraform
```hcl
# Container App
resource "azurerm_container_app" "ai_app" {
  name                         = "ai-app"
  container_app_environment_id = azurerm_container_app_environment.env.id
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"

  template {
    container {
      name   = "ai-app"
      image  = "${azurerm_container_registry.acr.login_server}/ai-app:latest"
      cpu    = 2
      memory = "4Gi"

      env {
        name  = "AZURE_OPENAI_ENDPOINT"
        value = azurerm_cognitive_account.openai.endpoint
      }

      env {
        name        = "AZURE_OPENAI_KEY"
        secret_name = "openai-key"
      }
    }

    min_replicas = 1
    max_replicas = 10
  }

  ingress {
    external_enabled = true
    target_port      = 8080
  }

  secret {
    name  = "openai-key"
    value = azurerm_cognitive_account.openai.primary_access_key
  }
}
```

## Security Best Practices

1. **Managed Identity** - No credentials in code
2. **Key Vault** - Store secrets and certificates
3. **Private Endpoints** - Keep traffic on Azure backbone
4. **Azure Firewall** - Network security
5. **RBAC** - Role-based access control

## Monitoring

### Application Insights
```python
from opencensus.ext.azure.log_exporter import AzureLogHandler
from opencensus.ext.azure.trace_exporter import AzureExporter
from opencensus.trace.samplers import ProbabilitySampler
from opencensus.trace.tracer import Tracer

# Setup tracing
tracer = Tracer(
    exporter=AzureExporter(connection_string=app_insights_conn),
    sampler=ProbabilitySampler(1.0)
)

# Custom metrics
from opencensus.stats import stats as stats_module
from opencensus.stats import measure as measure_module
from opencensus.stats import view as view_module

llm_latency = measure_module.MeasureFloat(
    "llm_latency", "LLM call latency", "ms"
)

# Track LLM calls
with tracer.span(name="llm_call") as span:
    span.add_attribute("model", "gpt-4")
    response = call_llm(prompt)
    span.add_attribute("tokens", response.usage.total_tokens)
```

## Cost Optimization

1. **Reserved Instances** - Up to 72% savings
2. **Spot VMs** - For batch workloads
3. **Auto-scaling** - Scale to zero when idle
4. **Azure Hybrid Benefit** - Use existing licenses
5. **Cost Management** - Set budgets and alerts

## Deployment Checklist

- [ ] Managed Identity configured
- [ ] Secrets in Key Vault
- [ ] Private endpoints if needed
- [ ] Application Insights enabled
- [ ] Log Analytics workspace connected
- [ ] Budget alerts configured
- [ ] RBAC roles assigned
- [ ] Zone redundancy for production
