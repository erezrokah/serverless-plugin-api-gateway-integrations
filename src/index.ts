import changeCase = require('change-case');
import { Options } from 'serverless';
import {
  Serverless,
  ApiGatewayIntegration,
  AwsProvider,
  CFTemplate,
  IntegrationType,
} from './types';

class ServerlessPlugin {
  public serverless: Serverless;
  // @ts-ignore
  public options: Options;
  // @ts-ignore
  public hooks: Record<string, () => void>;

  private apiGatewayMethodLogicalIds: string[];

  public constructor(serverless: Serverless, options: Options) {
    this.serverless = serverless;
    this.options = options;

    this.hooks = {
      'before:package:finalize': this.createIntegrations.bind(this),
    };

    this.apiGatewayMethodLogicalIds = [];
  }

  private addIntegration(
    provider: AwsProvider,
    integration: ApiGatewayIntegration,
    apiGatewayLogicalId: string,
    template: CFTemplate,
  ) {
    this.serverless.cli.log(
      `Adding integration: ${JSON.stringify(integration)}`,
    );
    const { type } = integration;
    if (type !== IntegrationType.SQS) {
      throw new Error(`Unsupported integration type: ${type}`);
    }

    // create queues
    const {
      name,
      visibilityTimeout = 60,
      path = integration.name,
      authorizationType = 'NONE',
      authorizerId,
      requestParameters = {},
    } = integration;
    const stackName = provider.naming.getStackName();

    const postfix = `api-gateway-integration-${type}-${name}`;
    const queueName = `${stackName}-${postfix}`;
    const queueLogicalId = changeCase.pascalCase(`${postfix}`);

    const dlqName = `${stackName}-${postfix}-dlq`;
    const dlqLogicalId = changeCase.pascalCase(`${postfix}-dlq`);

    const queue = {
      [queueLogicalId]: {
        Type: 'AWS::SQS::Queue',
        Properties: {
          QueueName: queueName,
          VisibilityTimeout: visibilityTimeout,
          RedrivePolicy: {
            deadLetterTargetArn: {
              'Fn::GetAtt': [dlqLogicalId, 'Arn'],
            },
            maxReceiveCount: 1,
          },
        },
      },
    };

    const dlq = {
      [dlqLogicalId]: {
        Type: 'AWS::SQS::Queue',
        Properties: {
          QueueName: dlqName,
          MessageRetentionPeriod: 1209600, // 14 days in seconds
        },
      },
    };

    // create api gateway resource
    const queueApiGatewayResourceId = queueLogicalId + 'ApiGatewayResource';
    const queueApiGatewayResource = {
      [queueApiGatewayResourceId]: {
        Type: 'AWS::ApiGateway::Resource',
        Properties: {
          ParentId: { 'Fn::GetAtt': [apiGatewayLogicalId, 'RootResourceId'] },
          PathPart: path,
          RestApiId: { Ref: apiGatewayLogicalId },
        },
      },
    };

    // iam role
    const queueIamRoleId = `${queueLogicalId}IAMRole`;
    const queueIamRole = {
      [queueIamRoleId]: {
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
              PolicyName: `${queueLogicalId}Policy`,
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  {
                    Effect: 'Allow',
                    Action: ['sqs:SendMessage'],
                    Resource: {
                      'Fn::GetAtt': [queueLogicalId, 'Arn'],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    };

    // create methods
    const methodId = `${queueLogicalId}Method`;
    const mockMethodId = `${queueLogicalId}MockMethod`;

    const method = {
      [methodId]: {
        Type: 'AWS::ApiGateway::Method',
        DependsOn: queueLogicalId,
        Properties: {
          RestApiId: { Ref: apiGatewayLogicalId },
          ResourceId: { Ref: queueApiGatewayResourceId },
          HttpMethod: 'POST',
          AuthorizationType: authorizationType,
          AuthorizerId: authorizerId,
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
            Credentials: { 'Fn::GetAtt': [queueIamRoleId, 'Arn'] },
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
              'integration.request.querystring.QueueUrl': `'#{${queueLogicalId}}'`,
              'integration.request.querystring.MessageBody':
                'method.request.body',
              ...requestParameters,
            },
            Uri: `arn:aws:apigateway:${provider.getRegion()}:sqs:action/SendMessage`,
          },
        },
      },
    };

    const mockMethod = {
      [mockMethodId]: {
        Type: 'AWS::ApiGateway::Method',
        DependsOn: queueLogicalId,
        Properties: {
          RestApiId: { Ref: apiGatewayLogicalId },
          ResourceId: { Ref: queueApiGatewayResourceId },
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
            Credentials: { 'Fn::GetAtt': [queueIamRoleId, 'Arn'] },
            RequestTemplates: {
              'application/json': '{statusCode:200}',
            },
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
                ResponseTemplates: {
                  'application/json': '',
                },
              },
            ],
          },
        },
      },
    };

    this.apiGatewayMethodLogicalIds.push(methodId);

    // put everything together
    template.Resources = {
      ...template.Resources,
      ...queue,
      ...dlq,
      ...queueApiGatewayResource,
      ...queueIamRole,
      ...method,
      ...mockMethod,
    };
    template.Outputs = {
      ...template.Outputs,
      [`${queueLogicalId}Arn`]: {
        Value: { 'Fn::GetAtt': [queueLogicalId, 'Arn'] },
      },
      [`${dlqLogicalId}Arn`]: {
        Value: { 'Fn::GetAtt': [dlqLogicalId, 'Arn'] },
      },
    };
  }

  private async createOrUpdateApiGateway(
    provider: AwsProvider,
    apiGatewayLogicalId: string,
    template: CFTemplate,
  ) {
    let { Resources, Outputs } = template;
    const apiGatewayDeploymentLogicalId = provider.naming.generateApiGatewayDeploymentLogicalId(
      this.serverless.instanceId,
    );

    // create the api gateway if required
    if (!Resources[apiGatewayLogicalId]) {
      const [stage, region] = [provider.getStage(), provider.getRegion()];

      Resources = {
        ...Resources,
        [apiGatewayLogicalId]: {
          Type: 'AWS::ApiGateway::RestApi',
          Properties: {
            Name: provider.naming.getApiGatewayName(),
            EndpointConfiguration: { Types: ['EDGE'] },
          },
        },
        [apiGatewayDeploymentLogicalId]: {
          Type: 'AWS::ApiGateway::Deployment',
          DependsOn: this.apiGatewayMethodLogicalIds,
          Properties: {
            RestApiId: { Ref: apiGatewayLogicalId },
            StageName: stage,
          },
        },
      };
      Outputs = {
        ...Outputs,
        ServiceEndpoint: {
          Description: 'URL of the service endpoint',
          Value: `https://#{${apiGatewayLogicalId}}.execute-api.${region}.amazonaws.com/${stage}`,
        },
      };
    } else {
      // don't create the api gateway, just add to DependsOn
      const DependsOn = Resources[apiGatewayDeploymentLogicalId]
        .DependsOn as string[];
      DependsOn.push(...this.apiGatewayMethodLogicalIds);
    }

    template.Resources = Resources;
    template.Outputs = Outputs;
  }

  public createIntegrations() {
    const { apiGatewayIntegrations } = this.serverless.service.custom;

    if (!apiGatewayIntegrations) {
      this.serverless.cli.log(
        'No API Gateway integrations to add',
        'Serverless',
        { color: 'yellow' },
      );
      return;
    }

    const provider = this.serverless.getProvider('aws');
    let {
      compiledCloudFormationTemplate: template,
    } = this.serverless.service.provider;

    const apiGatewayLogicalId = provider.naming.getRestApiLogicalId();

    for (const integration of apiGatewayIntegrations) {
      this.addIntegration(provider, integration, apiGatewayLogicalId, template);
    }

    this.createOrUpdateApiGateway(provider, apiGatewayLogicalId, template);
  }
}

export = ServerlessPlugin;
