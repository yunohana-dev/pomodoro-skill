import {
  CfnOutput, Duration, RemovalPolicy, Stack, StackProps,
  aws_iam as iam,
  aws_lambda as lambda,
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
        roleName: `pomodoro-${this.account}`,
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
      });
    bucket.grantRead(role);

    const handler = new lambda.Function(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const AWS = require('aws-sdk');
        const s3 = new AWS.S3();

        exports.handler = async (event) => {
          console.log('Request:', JSON.stringify(event, null, 2));

          const requestType = event.request.type;
          const intentName = event.request.intent?.name;

          if (requestType === 'LaunchRequest' || intentName === 'StartPomodoroIntent') {
            try {
              // List MP4 files from S3 bucket
              const bucketName = process.env.BUCKET_NAME;
              const listParams = {
                Bucket: bucketName,
                Prefix: '',
              };

              const objects = await s3.listObjectsV2(listParams).promise();
              const mp4Files = objects.Contents
                .filter(obj => obj.Key.toLowerCase().endsWith('.mp4'))
                .sort((a, b) => a.Key.localeCompare(b.Key))
                .map(obj => obj.Key);

              if (mp4Files.length === 0) {
                return {
                  version: '1.0',
                  response: {
                    outputSpeech: {
                      type: 'PlainText',
                      text: 'ポモドーロ用の動画ファイルが見つかりません。',
                    },
                    shouldEndSession: true,
                  },
                };
              }

              // Generate presigned URLs for MP4 files
              const videoUrls = await Promise.all(
                mp4Files.map(async (key) => {
                  const url = await s3.getSignedUrlPromise('getObject', {
                    Bucket: bucketName,
                    Key: key,
                    Expires: 3600, // 1 hour
                  });
                  return url;
                })
              );

              return {
                version: '1.0',
                response: {
                  outputSpeech: {
                    type: 'PlainText',
                    text: 'ポモドーロを開始します。',
                  },
                  directives: [
                    {
                      type: 'VideoApp.Launch',
                      videoItem: {
                        source: videoUrls[0],
                        metadata: {
                          title: 'ポモドーロタイマー',
                          subtitle: 'Focus Time',
                        },
                      },
                    },
                  ],
                  shouldEndSession: true,
                },
              };
            } catch (error) {
              console.error('Error:', error);
              return {
                version: '1.0',
                response: {
                  outputSpeech: {
                    type: 'PlainText',
                    text: 'エラーが発生しました。もう一度お試しください。',
                  },
                  shouldEndSession: true,
                },
              };
            }
          }

          return {
            version: '1.0',
            response: {
              outputSpeech: {
                type: 'PlainText',
                text: 'こんにちは。ポモドーロと言ってください。',
              },
              shouldEndSession: false,
            },
          };
        };
      `),
      environment: {
        BUCKET_NAME: bucket.bucketName,
      },
      role: role,
      timeout: Duration.seconds(30),
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

