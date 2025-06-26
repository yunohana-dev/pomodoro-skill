import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

declare const process: {
  env: {
    BUCKET_NAME?: string;
    AWS_REGION?: string;
  };
};

declare const console: {
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });

// S3からMP4ファイル一覧を取得
async function getMp4Files(): Promise<string[]> {
  const bucketName = process.env.BUCKET_NAME;
  const command = new ListObjectsV2Command({
    Bucket: bucketName!,
    Prefix: '',
  });

  const objects = await s3Client.send(command);
  const mp4Files = objects.Contents
    ?.filter(obj => obj.Key!.toLowerCase().endsWith('.mp4'))
    .sort((a, b) => a.Key!.localeCompare(b.Key!))
    .map(obj => obj.Key!) || [];

  console.log(`Found MP4 files:`, mp4Files);
  return mp4Files;
}

// S3からPresigned URLを生成
async function generatePresignedUrl(fileKey: string): Promise<string> {
  const bucketName = process.env.BUCKET_NAME;
  const getCommand = new GetObjectCommand({
    Bucket: bucketName!,
    Key: fileKey,
  });
  return await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
}

// APL Video documentを生成
function createVideoDocument(videoUrl: string, currentIndex: number) {
  return {
    type: 'APL',
    version: '1.8',
    mainTemplate: {
      parameters: ['videoData'],
      item: {
        type: 'Video',
        id: 'pomodoroVideo',
        width: '100vw',
        height: '100vh',
        source: videoUrl,
        scale: 'best-fit',
        autoplay: true,
        audioTrack: 'foreground',
        backgroundColor: 'black',
        onEnd: [{
          type: 'SendEvent',
          arguments: ['videoEnd', '${videoData.currentIndex}'],
        }],
      },
    },
  };
}

// Alexaレスポンスを生成するヘルパー関数
function createAlexaResponse(config: {
  outputSpeech?: string;
  shouldEndSession: boolean;
  directives?: any[];
  sessionAttributes?: any;
}): any {
  const response: any = {
    version: '1.0',
    response: {
      shouldEndSession: config.shouldEndSession,
    },
  };

  if (config.outputSpeech) {
    response.response.outputSpeech = {
      type: 'PlainText',
      text: config.outputSpeech,
    };
  }

  if (config.directives) {
    response.response.directives = config.directives;
  }

  if (config.sessionAttributes) {
    response.sessionAttributes = config.sessionAttributes;
  }

  return response;
}

// エラーハンドリング
function handleError(context: string, error: any): any {
  console.error(`Error in ${context} processing:`, error);
  console.error(`${context} Error stack:`, error instanceof Error ? error.stack : 'No stack trace');

  const errorResponse = createAlexaResponse({
    outputSpeech: context === 'Launch' ? 'エラーが発生しました。もう一度お試しください。' : undefined,
    shouldEndSession: true,
  });

  console.log(`=== ${context.toUpperCase()} ERROR RESPONSE ===`);
  console.log(JSON.stringify(errorResponse, null, 2));
  return errorResponse;
}

// LaunchRequestを処理
async function handleLaunchRequest(): Promise<any> {
  try {
    console.log(`=== LAUNCH REQUEST ===`);

    const mp4Files = await getMp4Files();
    console.log(`Found MP4 files for launch:`, mp4Files);

    if (mp4Files.length === 0) {
      console.log('No MP4 files found');
      return createAlexaResponse({
        outputSpeech: 'ポモドーロ用の動画ファイルが見つかりません。',
        shouldEndSession: true,
      });
    }

    const firstVideoUrl = await generatePresignedUrl(mp4Files[0]);
    console.log(`First video URL: ${firstVideoUrl}`);

    const response = createAlexaResponse({
      outputSpeech: 'ポモドーロを開始します。',
      shouldEndSession: false,
      directives: [{
        type: 'Alexa.Presentation.APL.RenderDocument',
        document: createVideoDocument(firstVideoUrl, 0),
        datasources: {
          videoData: {
            currentIndex: 0,
          }
        },
      }],
      sessionAttributes: {
        mp4Files: mp4Files,
        totalVideos: mp4Files.length
      },
    });

    console.log('=== LAUNCH RESPONSE ===');
    console.log(JSON.stringify(response, null, 2));
    return response;

  } catch (error) {
    return handleError('Launch', error);
  }
}

// APL UserEventを処理
async function handleUserEvent(event: any): Promise<any> {
  const userEventType = event.request.arguments?.[0];
  const currentIndexArg = event.request.arguments?.[1];

  console.log(`=== PROCESSING USER EVENT ===`);
  console.log(`UserEvent Type: ${userEventType}`);
  console.log(`Current Index Argument:`, currentIndexArg);
  console.log(`Arguments Array:`, event.request.arguments);
  console.log(`Comparing userEventType: "${userEventType}" === "videoEnd": ${userEventType === 'videoEnd'}`);

  if (userEventType !== 'videoEnd') {
    console.log(`=== USER EVENT TYPE NOT MATCHED ===`);
    console.log(`Expected: "videoEnd", Received: "${userEventType}"`);
    console.log(`Event will not be processed`);

    console.log(`=== USER EVENT PROCESSING COMPLETE ===`);
    return createAlexaResponse({
      shouldEndSession: false,
    });
  }

  try {
    console.log(`=== VIDEO END EVENT DETECTED ===`);

    let currentIndex = 0;
    if (typeof currentIndexArg === 'number') {
      currentIndex = currentIndexArg;
    } else if (typeof currentIndexArg === 'string') {
      currentIndex = parseInt(currentIndexArg, 10) || 0;
    } else if (typeof currentIndexArg === 'object' && currentIndexArg !== null) {
      currentIndex = currentIndexArg.value || currentIndexArg.currentIndex || 0;
    }
    console.log(`Current Index: ${currentIndex}`);

    const nextIndex = currentIndex + 1;
    console.log(`Next Index: ${nextIndex}`);

    const mp4Files = await getMp4Files();
    console.log(`Re-fetched MP4 files from S3:`, mp4Files);
    console.log(`Total videos: ${mp4Files.length}`);

    // 最後の動画を再生し終えた場合はスキルを終了
    if (nextIndex >= mp4Files.length) {
      console.log(`=== PLAYLIST COMPLETED ===`);
      console.log(`All ${mp4Files.length} videos have been played`);

      const response = createAlexaResponse({
        outputSpeech: 'ポモドーロセッションが完了しました。お疲れ様でした。',
        shouldEndSession: true,
      });

      console.log('=== PLAYLIST END RESPONSE ===');
      console.log(JSON.stringify(response, null, 2));
      return response;
    }

    const nextVideoKey = mp4Files[nextIndex];
    console.log(`Next Video Key: ${nextVideoKey}`);

    if (!nextVideoKey) {
      throw new Error(`No video found at index ${nextIndex}`);
    }

    const nextVideoUrl = await generatePresignedUrl(nextVideoKey);
    console.log(`Next Video URL: ${nextVideoUrl}`);

    const response = {
      version: '1.0',
      response: {
        directives: [{
          type: 'Alexa.Presentation.APL.RenderDocument',
          document: createVideoDocument(nextVideoUrl, nextIndex),
          datasources: {
            videoData: {
              currentIndex: nextIndex,
            }
          },
        }],
      },
      sessionAttributes: {
        mp4Files: mp4Files,
        totalVideos: mp4Files.length
      },
    };
    console.log('=== VIDEO SWITCH RESPONSE ===');
    console.log(JSON.stringify(response, null, 2));
    return response;

  } catch (error) {
    return handleError('UserEvent', error);
  }
}

export const handler = async (event: any) => {
  console.log('=== FULL REQUEST ===');
  console.log(JSON.stringify(event, null, 2));

  const requestType = event.request.type;
  const intentName = event.request.intent?.name;

  console.log(`Request Type: ${requestType}`);
  console.log(`Intent Name: ${intentName}`);

  try {
    // APL UserEventを処理
    if (requestType === 'Alexa.Presentation.APL.UserEvent') {
      return await handleUserEvent(event);
    }

    // LaunchRequestを処理
    if (requestType === 'LaunchRequest' || intentName === 'StartPomodoroIntent') {
      return await handleLaunchRequest();
    }

    // デフォルトレスポンス
    const defaultResponse = createAlexaResponse({
      outputSpeech: 'こんにちは。ポモドーロと言ってください。',
      shouldEndSession: false,
    });
    console.log('=== DEFAULT RESPONSE ===');
    console.log(JSON.stringify(defaultResponse, null, 2));
    return defaultResponse;

  } catch (error) {
    return handleError('Handler', error);
  }
};
