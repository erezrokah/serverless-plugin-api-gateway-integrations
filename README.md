# serverless-plugin-api-gateway-integrations

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CircleCI](https://circleci.com/gh/erezrokah/serverless-plugin-api-gateway-integrations.svg?style=svg)](https://circleci.com/gh/erezrokah/serverless-plugin-api-gateway-integrations)

> Note: If you're missing any capability please open an issue/feature request :)

## Introduction

I wrote this plugin since I wanted to wrap my lambda with an SQS queue.<br/>
I found that there is a lot of boilerplate when writing SQS API Gateway integration hence this plugin.<br/>
I'm open to adding more integrations and configuration options :)

## Installation

Install with [yarn](https://github.com/yarnpkg/yarn)

```bash
yarn add serverless-plugin-api-gateway-integrations --dev
```

or [npm](https://www.npmjs.com/)

```bash
npm install serverless-plugin-api-gateway-integrations --save-dev
```

## Usage

In your `serverless.yml` under `plugins` add

```yaml
plugins:
  - serverless-plugin-api-gateway-integrations
```

Under `custom` add:

```yaml
custom:
  apiGatewayIntegrations:
    - { type: sqs, name: 'queue' } # only sqs is supported at the moment
```

You can reference the created queues' ARNs by using Pascal case naming:

```yaml
functions:
  consumer:
    events:
      - sqs:
          arn: !GetAtt ApiGatewayIntegrationSqsQueue.Arn

  errorHandler:
    events:
      - sqs:
          arn: !GetAtt ApiGatewayIntegrationSqsQueueDlq.Arn
```

The plugin will create an API gateway (or use the existing default one if exists), and add all the necessary resources, methods and roles (with cors support).

Then you can do:

```bash
curl -d '{"message":"Hello World!"}' -H "Content-Type: application/json" -X POST https://*************.execute-api.us-east-1.amazonaws.com/dev/queue
```
