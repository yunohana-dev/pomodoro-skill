import {
  CfnOutput, Duration, RemovalPolicy, Stack, StackProps,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_s3 as s3,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class RootStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const
      bucket = new s3.Bucket(this, 'Bucket', {
        bucketName: `pomodoro-${this.account}`,
        versioned: false,
        publicReadAccess: false,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      }),
      role = new iam.Role(this, 'Role', {
        roleName: `pomodoro`,
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      });
    bucket.grantRead(role);

    const handler = new nodejs.NodejsFunction(this, 'Function', {
      functionName: 'pomodoro-skill',
      entry: 'lib/handler.ts',
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: {
        BUCKET_NAME: bucket.bucketName,
      },
      role: role,
      timeout: Duration.seconds(30),
      bundling: {
        minify: true,
        sourceMap: false,
        target: 'node22',
      },
    });

    new CfnOutput(this, 'BucketName', {
      value: bucket.bucketName,
      description: 'S3 bucket name for MP4 files',
    });
    new CfnOutput(this, 'AlexaSkillFunctionArn', {
      value: handler.functionArn,
      description: 'Lambda function ARN for Alexa skill',
    });
  }
}

