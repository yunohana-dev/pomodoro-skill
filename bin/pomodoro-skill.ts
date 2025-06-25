#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { RootStack } from '../lib/pomodoro-skill-stack';

const app = new App();
new RootStack(app, 'PomodoroSkill', {
  env: { region: 'ap-northeast-1' },
});

