export enum IntegrationType {
  SQS = 'sqs',
}

export interface ApiGatewayIntegration {
  type: IntegrationType;
  name: string;
  visibilityTimeout?: number;
  path?: string;
  authorizationType?: string;
  authorizerId?: string;
  requestParameters?: Record<string, string>;
}

export interface AwsProvider {
  getStage: () => string;
  getRegion: () => string;

  naming: {
    generateApiGatewayDeploymentLogicalId: (id: string) => string;
    getRestApiLogicalId: () => string;
    getApiGatewayName: () => string;
    getStackName: () => string;
  };
}

export interface CFTemplate {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Resources: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Outputs?: Record<string, any>;
}

export interface Serverless {
  instanceId: string;

  cli: {
    log(
      message: string,
      prefix?: string,
      options?: Record<string, string>,
    ): null;
  };

  getProvider: (provider: string) => AwsProvider;

  service: {
    provider: {
      compiledCloudFormationTemplate: CFTemplate;
    };
    custom: {
      apiGatewayIntegrations?: ApiGatewayIntegration[];
    };
  };
}
