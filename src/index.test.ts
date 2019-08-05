import ServerlessPlugin = require('./');
import { IntegrationType } from './types';

const options = {
  stage: 'test',
  region: 'us-east-test-1',
};

const provider = {
  getStage: jest.fn(() => options.stage),
  getRegion: jest.fn(() => options.region),
  naming: {
    generateApiGatewayDeploymentLogicalId: jest.fn(
      () => 'ApiGatewayDeploymentLogicalId',
    ),
    getRestApiLogicalId: jest.fn(() => 'RestApiLogicalId'),
    getApiGatewayName: jest.fn(() => 'api-gateway-name'),
    getStackName: jest.fn(() => 'stack-name'),
  },
};

const serverless = {
  instanceId: 'testInstanceId',
  cli: {
    log: jest.fn(),
  },

  getProvider: jest.fn(() => provider),
  service: {
    provider: {
      compiledCloudFormationTemplate: { Resources: {} },
    },
    custom: {},
  },
};

describe('index', () => {
  test('should initialize plugin', () => {
    const plugin = new ServerlessPlugin(serverless, options);

    expect(plugin.serverless).toBe(serverless);
    expect(plugin.options).toBe(options);
    expect(plugin.hooks).toEqual({
      'before:package:finalize': expect.any(Function),
    });
  });

  test('should write to log on no integrations', () => {
    const plugin = new ServerlessPlugin(serverless, options);

    plugin.createIntegrations();

    expect(serverless.cli.log).toHaveBeenCalledTimes(1);
    expect(serverless.cli.log).toHaveBeenCalledWith(
      'No API Gateway integrations to add',
      'Serverless',
      { color: 'yellow' },
    );
  });

  test('should throw error on wrong integration', () => {
    const name = 'test-queue';
    const apiGatewayIntegrations = [{ type: 'sns', name }];

    const compiledCloudFormationTemplate = { Resources: {} };
    const plugin = new ServerlessPlugin(
      {
        ...serverless,
        service: {
          ...serverless.service,
          provider: {
            compiledCloudFormationTemplate,
          },
          custom: {
            // @ts-ignore
            apiGatewayIntegrations,
          },
        },
      },
      options,
    );

    expect(() => plugin.createIntegrations()).toThrow(
      new Error(
        `Unsupported integration type: ${apiGatewayIntegrations[0].type}`,
      ),
    );
  });

  test('should create new gateway and sqs integration', () => {
    const name = 'test-queue';
    const apiGatewayIntegrations = [{ type: IntegrationType.SQS, name }];

    const compiledCloudFormationTemplate = { Resources: {} };
    const plugin = new ServerlessPlugin(
      {
        ...serverless,
        service: {
          ...serverless.service,
          provider: {
            compiledCloudFormationTemplate,
          },
          custom: {
            apiGatewayIntegrations,
          },
        },
      },
      options,
    );

    plugin.createIntegrations();

    expect(compiledCloudFormationTemplate).toEqual({
      Resources: {
        ApiGatewayIntegrationSqsTestQueue: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            QueueName: 'stack-name-api-gateway-integration-sqs-test-queue',
            VisibilityTimeout: 60,
            RedrivePolicy: {
              deadLetterTargetArn: {
                'Fn::GetAtt': ['ApiGatewayIntegrationSqsTestQueueDlq', 'Arn'],
              },
              maxReceiveCount: 5,
            },
          },
        },
        ApiGatewayIntegrationSqsTestQueueDlq: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            QueueName: 'stack-name-api-gateway-integration-sqs-test-queue-dlq',
            MessageRetentionPeriod: 1209600,
          },
        },
        ApiGatewayIntegrationSqsTestQueueApiGatewayResource: {
          Type: 'AWS::ApiGateway::Resource',
          Properties: {
            ParentId: { 'Fn::GetAtt': ['RestApiLogicalId', 'RootResourceId'] },
            PathPart: 'test-queue',
            RestApiId: { Ref: 'RestApiLogicalId' },
          },
        },
        ApiGatewayIntegrationSqsTestQueueIAMRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            Path: '/',
            AssumeRolePolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: { Service: ['apigateway.amazonaws.com'] },
                  Action: 'sts:AssumeRole',
                },
              ],
            },
            ManagedPolicyArns: [
              'arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs',
            ],
            Policies: [
              {
                PolicyName: 'ApiGatewayIntegrationSqsTestQueuePolicy',
                PolicyDocument: {
                  Version: '2012-10-17',
                  Statement: [
                    {
                      Effect: 'Allow',
                      Action: ['sqs:SendMessage'],
                      Resource: {
                        'Fn::GetAtt': [
                          'ApiGatewayIntegrationSqsTestQueue',
                          'Arn',
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        ApiGatewayIntegrationSqsTestQueueMethod: {
          Type: 'AWS::ApiGateway::Method',
          DependsOn: 'ApiGatewayIntegrationSqsTestQueue',
          Properties: {
            RestApiId: { Ref: 'RestApiLogicalId' },
            ResourceId: {
              Ref: 'ApiGatewayIntegrationSqsTestQueueApiGatewayResource',
            },
            HttpMethod: 'POST',
            AuthorizationType: 'NONE',
            RequestParameters: {
              'method.request.header.Authorization': false,
            },
            MethodResponses: [
              {
                StatusCode: '200',
                ResponseParameters: {
                  'method.response.header.Access-Control-Allow-Origin': true,
                },
              },
            ],
            Integration: {
              Type: 'AWS',
              Credentials: {
                'Fn::GetAtt': [
                  'ApiGatewayIntegrationSqsTestQueueIAMRole',
                  'Arn',
                ],
              },
              IntegrationHttpMethod: 'POST',
              IntegrationResponses: [
                {
                  StatusCode: '200',
                  ResponseParameters: {
                    'method.response.header.Access-Control-Allow-Origin': "'*'",
                  },
                },
              ],
              RequestParameters: {
                'integration.request.querystring.QueueUrl':
                  "'#{ApiGatewayIntegrationSqsTestQueue}'",
                'integration.request.querystring.MessageBody':
                  'method.request.body',
              },
              Uri: 'arn:aws:apigateway:us-east-test-1:sqs:action/SendMessage',
            },
          },
        },
        ApiGatewayIntegrationSqsTestQueueMockMethod: {
          Type: 'AWS::ApiGateway::Method',
          DependsOn: 'ApiGatewayIntegrationSqsTestQueue',
          Properties: {
            RestApiId: { Ref: 'RestApiLogicalId' },
            ResourceId: {
              Ref: 'ApiGatewayIntegrationSqsTestQueueApiGatewayResource',
            },
            HttpMethod: 'OPTIONS',
            AuthorizationType: 'NONE',
            MethodResponses: [
              {
                StatusCode: '200',
                ResponseParameters: {
                  'method.response.header.Access-Control-Allow-Origin': true,
                  'method.response.header.Access-Control-Allow-Headers': true,
                  'method.response.header.Access-Control-Allow-Methods': true,
                  'method.response.header.Access-Control-Allow-Credentials': true,
                },
              },
            ],
            Integration: {
              Type: 'MOCK',
              Credentials: {
                'Fn::GetAtt': [
                  'ApiGatewayIntegrationSqsTestQueueIAMRole',
                  'Arn',
                ],
              },
              RequestTemplates: { 'application/json': '{statusCode:200}' },
              IntegrationResponses: [
                {
                  StatusCode: '200',
                  ResponseParameters: {
                    'method.response.header.Access-Control-Allow-Origin': "'*'",
                    'method.response.header.Access-Control-Allow-Headers':
                      "'Content-Type,x-api-token,authorizationtoken,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
                    'method.response.header.Access-Control-Allow-Methods':
                      "'OPTIONS,POST'",
                    'method.response.header.Access-Control-Allow-Credentials':
                      "'true'",
                  },
                  ResponseTemplates: { 'application/json': '' },
                },
              ],
            },
          },
        },
        RestApiLogicalId: {
          Type: 'AWS::ApiGateway::RestApi',
          Properties: {
            Name: 'api-gateway-name',
            EndpointConfiguration: { Types: ['EDGE'] },
          },
        },
        ApiGatewayDeploymentLogicalId: {
          Type: 'AWS::ApiGateway::Deployment',
          DependsOn: ['ApiGatewayIntegrationSqsTestQueueMethod'],
          Properties: {
            RestApiId: { Ref: 'RestApiLogicalId' },
            StageName: 'test',
          },
        },
      },
      Outputs: {
        ApiGatewayIntegrationSqsTestQueueArn: {
          Value: { 'Fn::GetAtt': ['ApiGatewayIntegrationSqsTestQueue', 'Arn'] },
        },
        ApiGatewayIntegrationSqsTestQueueDlqArn: {
          Value: {
            'Fn::GetAtt': ['ApiGatewayIntegrationSqsTestQueueDlq', 'Arn'],
          },
        },
        ServiceEndpoint: {
          Description: 'URL of the service endpoint',
          Value:
            'https://#{RestApiLogicalId}.execute-api.us-east-test-1.amazonaws.com/test',
        },
      },
    });
  });

  test('should update existing gateway with sqs integration', () => {
    const name = 'test-queue';
    const apiGatewayIntegrations = [{ type: IntegrationType.SQS, name }];

    const compiledCloudFormationTemplate = {
      Resources: {
        RestApiLogicalId: {},
        ApiGatewayDeploymentLogicalId: {
          DependsOn: ['Existing Dependency'],
        },
      },
      Outputs: {
        ServiceEndpoint: {},
      },
    };
    const plugin = new ServerlessPlugin(
      {
        ...serverless,
        service: {
          ...serverless.service,
          provider: {
            compiledCloudFormationTemplate,
          },
          custom: {
            apiGatewayIntegrations,
          },
        },
      },
      options,
    );

    plugin.createIntegrations();

    expect(compiledCloudFormationTemplate).toEqual({
      Resources: {
        ApiGatewayIntegrationSqsTestQueue: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            QueueName: 'stack-name-api-gateway-integration-sqs-test-queue',
            VisibilityTimeout: 60,
            RedrivePolicy: {
              deadLetterTargetArn: {
                'Fn::GetAtt': ['ApiGatewayIntegrationSqsTestQueueDlq', 'Arn'],
              },
              maxReceiveCount: 5,
            },
          },
        },
        ApiGatewayIntegrationSqsTestQueueDlq: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            QueueName: 'stack-name-api-gateway-integration-sqs-test-queue-dlq',
            MessageRetentionPeriod: 1209600,
          },
        },
        ApiGatewayIntegrationSqsTestQueueApiGatewayResource: {
          Type: 'AWS::ApiGateway::Resource',
          Properties: {
            ParentId: { 'Fn::GetAtt': ['RestApiLogicalId', 'RootResourceId'] },
            PathPart: 'test-queue',
            RestApiId: { Ref: 'RestApiLogicalId' },
          },
        },
        ApiGatewayIntegrationSqsTestQueueIAMRole: {
          Type: 'AWS::IAM::Role',
          Properties: {
            Path: '/',
            AssumeRolePolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Principal: { Service: ['apigateway.amazonaws.com'] },
                  Action: 'sts:AssumeRole',
                },
              ],
            },
            ManagedPolicyArns: [
              'arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs',
            ],
            Policies: [
              {
                PolicyName: 'ApiGatewayIntegrationSqsTestQueuePolicy',
                PolicyDocument: {
                  Version: '2012-10-17',
                  Statement: [
                    {
                      Effect: 'Allow',
                      Action: ['sqs:SendMessage'],
                      Resource: {
                        'Fn::GetAtt': [
                          'ApiGatewayIntegrationSqsTestQueue',
                          'Arn',
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        ApiGatewayIntegrationSqsTestQueueMethod: {
          Type: 'AWS::ApiGateway::Method',
          DependsOn: 'ApiGatewayIntegrationSqsTestQueue',
          Properties: {
            RestApiId: { Ref: 'RestApiLogicalId' },
            ResourceId: {
              Ref: 'ApiGatewayIntegrationSqsTestQueueApiGatewayResource',
            },
            HttpMethod: 'POST',
            AuthorizationType: 'NONE',
            RequestParameters: {
              'method.request.header.Authorization': false,
            },
            MethodResponses: [
              {
                StatusCode: '200',
                ResponseParameters: {
                  'method.response.header.Access-Control-Allow-Origin': true,
                },
              },
            ],
            Integration: {
              Type: 'AWS',
              Credentials: {
                'Fn::GetAtt': [
                  'ApiGatewayIntegrationSqsTestQueueIAMRole',
                  'Arn',
                ],
              },
              IntegrationHttpMethod: 'POST',
              IntegrationResponses: [
                {
                  StatusCode: '200',
                  ResponseParameters: {
                    'method.response.header.Access-Control-Allow-Origin': "'*'",
                  },
                },
              ],
              RequestParameters: {
                'integration.request.querystring.QueueUrl':
                  "'#{ApiGatewayIntegrationSqsTestQueue}'",
                'integration.request.querystring.MessageBody':
                  'method.request.body',
              },
              Uri: 'arn:aws:apigateway:us-east-test-1:sqs:action/SendMessage',
            },
          },
        },
        ApiGatewayIntegrationSqsTestQueueMockMethod: {
          Type: 'AWS::ApiGateway::Method',
          DependsOn: 'ApiGatewayIntegrationSqsTestQueue',
          Properties: {
            RestApiId: { Ref: 'RestApiLogicalId' },
            ResourceId: {
              Ref: 'ApiGatewayIntegrationSqsTestQueueApiGatewayResource',
            },
            HttpMethod: 'OPTIONS',
            AuthorizationType: 'NONE',
            MethodResponses: [
              {
                StatusCode: '200',
                ResponseParameters: {
                  'method.response.header.Access-Control-Allow-Origin': true,
                  'method.response.header.Access-Control-Allow-Headers': true,
                  'method.response.header.Access-Control-Allow-Methods': true,
                  'method.response.header.Access-Control-Allow-Credentials': true,
                },
              },
            ],
            Integration: {
              Type: 'MOCK',
              Credentials: {
                'Fn::GetAtt': [
                  'ApiGatewayIntegrationSqsTestQueueIAMRole',
                  'Arn',
                ],
              },
              RequestTemplates: { 'application/json': '{statusCode:200}' },
              IntegrationResponses: [
                {
                  StatusCode: '200',
                  ResponseParameters: {
                    'method.response.header.Access-Control-Allow-Origin': "'*'",
                    'method.response.header.Access-Control-Allow-Headers':
                      "'Content-Type,x-api-token,authorizationtoken,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
                    'method.response.header.Access-Control-Allow-Methods':
                      "'OPTIONS,POST'",
                    'method.response.header.Access-Control-Allow-Credentials':
                      "'true'",
                  },
                  ResponseTemplates: { 'application/json': '' },
                },
              ],
            },
          },
        },
        RestApiLogicalId: {},
        ApiGatewayDeploymentLogicalId: {
          DependsOn: [
            'Existing Dependency',
            'ApiGatewayIntegrationSqsTestQueueMethod',
          ],
        },
      },
      Outputs: {
        ApiGatewayIntegrationSqsTestQueueArn: {
          Value: { 'Fn::GetAtt': ['ApiGatewayIntegrationSqsTestQueue', 'Arn'] },
        },
        ApiGatewayIntegrationSqsTestQueueDlqArn: {
          Value: {
            'Fn::GetAtt': ['ApiGatewayIntegrationSqsTestQueueDlq', 'Arn'],
          },
        },
        ServiceEndpoint: {},
      },
    });
  });
});
