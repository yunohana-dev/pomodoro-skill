import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as PomodoroSkill from '../lib/pomodoro-skill-stack';

test('S3 Bucket Created', () => {
  const app = new cdk.App();
  const stack = new PomodoroSkill.PomodoroSkillStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        {
          ServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256'
          }
        }
      ]
    }
  });
});

test('Lambda Function Created', () => {
  const app = new cdk.App();
  const stack = new PomodoroSkill.PomodoroSkillStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs18.x',
    Handler: 'index.handler'
  });
});
