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

export const handler = async (event: any) => {
  console.log('Request:', JSON.stringify(event, null, 2));

  const requestType = event.request.type;
  const intentName = event.request.intent?.name;

  if (requestType === 'LaunchRequest' || intentName === 'StartPomodoroIntent') {
    try {
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

      const videoUrls = await Promise.all(
        mp4Files.map(async (key) => {
          const getCommand = new GetObjectCommand({
            Bucket: bucketName!,
            Key: key,
          });
          const url = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
          return url;
        })
      );

      // APL方式（アスペクト比制御可能）
      const response = {
        version: '1.0',
        response: {
          outputSpeech: {
            type: 'PlainText',
            text: 'ポモドーロを開始します。',
          },
          directives: [
            {
              type: 'Alexa.Presentation.APL.RenderDocument',
              document: {
                type: 'APL',
                version: '1.8',
                mainTemplate: {
                  item: {
                    type: 'Video',
                    width: '100vw',
                    height: '100vh',
                    source: videoUrls[0],
                    scale: 'best-fit', // アスペクト比維持
                    autoplay: true,
                    audioTrack: 'foreground',
                    backgroundColor: 'black',
                  },
                },
              },
            },
          ],
        },
      };
      
      console.log('Response:', JSON.stringify(response, null, 2));
      return response;
    } catch (error) {
      console.error('Error:', error);
      const errorResponse = {
        version: '1.0',
        response: {
          outputSpeech: {
            type: 'PlainText',
            text: 'エラーが発生しました。もう一度お試しください。',
          },
          shouldEndSession: true,
        },
      };
      console.log('Error Response:', JSON.stringify(errorResponse, null, 2));
      return errorResponse;
    }
  }

  const defaultResponse = {
    version: '1.0',
    response: {
      outputSpeech: {
        type: 'PlainText',
        text: 'こんにちは。ポモドーロと言ってください。',
      },
      shouldEndSession: false,
    },
  };
  console.log('Default Response:', JSON.stringify(defaultResponse, null, 2));
  return defaultResponse;
};