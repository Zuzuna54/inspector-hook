# Deploying to AWS

## Overview
This skill covers deploying AI/ML applications to AWS using best practices for serverless, containers, and managed AI services.

## AWS Services for AI Applications

### Compute Options
1. **Lambda** - Serverless functions (up to 15 min, 10GB memory)
2. **ECS/Fargate** - Container orchestration
3. **App Runner** - Simplified container deployment
4. **EC2** - Full control, GPU instances for ML

### AI/ML Services
1. **Bedrock** - Managed foundation models (Claude, Titan, etc.)
2. **SageMaker** - Full ML platform
3. **Comprehend** - NLP analysis
4. **Textract** - Document processing

### Data & Storage
1. **S3** - Object storage for models, data
2. **RDS/Aurora** - Relational databases
3. **DynamoDB** - NoSQL with low latency
4. **OpenSearch** - Vector search capability
5. **ElastiCache** - Redis/Memcached caching

## Deployment Patterns

### Lambda + API Gateway
```yaml
# serverless.yml or SAM template
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  ApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: app.handler
      Runtime: python3.12
      MemorySize: 1024
      Timeout: 30
      Environment:
        Variables:
          BEDROCK_MODEL_ID: anthropic.claude-3-sonnet-20240229-v1:0
      Policies:
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action:
                - bedrock:InvokeModel
              Resource: '*'
      Events:
        Api:
          Type: Api
          Properties:
            Path: /chat
            Method: POST
```

### ECS Fargate Service
```yaml
# task-definition.json
{
  "family": "ai-app",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [{
    "name": "app",
    "image": "${ECR_URI}:${TAG}",
    "portMappings": [{
      "containerPort": 8080,
      "protocol": "tcp"
    }],
    "environment": [
      {"name": "AWS_REGION", "value": "us-east-1"}
    ],
    "secrets": [
      {"name": "API_KEY", "valueFrom": "arn:aws:secretsmanager:..."}
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/ai-app",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "ecs"
      }
    }
  }]
}
```

### Bedrock Integration
```python
import boto3
import json

bedrock = boto3.client('bedrock-runtime', region_name='us-east-1')

def invoke_claude(prompt: str) -> str:
    response = bedrock.invoke_model(
        modelId='anthropic.claude-3-sonnet-20240229-v1:0',
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}]
        })
    )
    result = json.loads(response['body'].read())
    return result['content'][0]['text']

# Streaming response
def invoke_claude_stream(prompt: str):
    response = bedrock.invoke_model_with_response_stream(
        modelId='anthropic.claude-3-sonnet-20240229-v1:0',
        body=json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}]
        })
    )
    for event in response['body']:
        chunk = json.loads(event['chunk']['bytes'])
        if chunk['type'] == 'content_block_delta':
            yield chunk['delta']['text']
```

## Infrastructure as Code

### CDK Example
```python
from aws_cdk import (
    Stack, Duration,
    aws_lambda as lambda_,
    aws_apigateway as apigw,
    aws_iam as iam,
)

class AiAppStack(Stack):
    def __init__(self, scope, id, **kwargs):
        super().__init__(scope, id, **kwargs)

        # Lambda function
        fn = lambda_.Function(
            self, "Handler",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="app.handler",
            code=lambda_.Code.from_asset("lambda"),
            timeout=Duration.seconds(30),
            memory_size=1024,
        )

        # Bedrock permissions
        fn.add_to_role_policy(iam.PolicyStatement(
            actions=["bedrock:InvokeModel"],
            resources=["*"]
        ))

        # API Gateway
        api = apigw.RestApi(self, "Api")
        api.root.add_resource("chat").add_method(
            "POST", apigw.LambdaIntegration(fn)
        )
```

## Security Best Practices

1. **IAM Least Privilege** - Only grant necessary permissions
2. **Secrets Manager** - Store API keys and credentials
3. **VPC** - Run in private subnets when possible
4. **WAF** - Protect API Gateway endpoints
5. **CloudTrail** - Audit all API calls

## Monitoring

```python
# CloudWatch metrics
import boto3

cloudwatch = boto3.client('cloudwatch')

def put_metric(name: str, value: float, unit: str = 'Count'):
    cloudwatch.put_metric_data(
        Namespace='AI-App',
        MetricData=[{
            'MetricName': name,
            'Value': value,
            'Unit': unit
        }]
    )

# Track LLM usage
put_metric('BedrockInvocations', 1)
put_metric('InputTokens', response['usage']['input_tokens'])
put_metric('OutputTokens', response['usage']['output_tokens'])
```

## Cost Optimization

1. **Reserved Capacity** - For predictable workloads
2. **Spot Instances** - For batch processing
3. **Provisioned Throughput** - Bedrock model reservations
4. **S3 Lifecycle** - Tier old data to Glacier
5. **Right-sizing** - Monitor and adjust resources

## Deployment Checklist

- [ ] IAM roles with least privilege
- [ ] Secrets stored in Secrets Manager
- [ ] VPC configured if needed
- [ ] CloudWatch alarms set up
- [ ] X-Ray tracing enabled
- [ ] Cost alerts configured
- [ ] Backup strategy defined
- [ ] Multi-AZ for production
