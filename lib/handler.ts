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
  console.log('=== FULL REQUEST ===');
  console.log(JSON.stringify(event, null, 2));

  const requestType = event.request.type;
  const intentName = event.request.intent?.name;

  console.log(`Request Type: ${requestType}`);
  console.log(`Intent Name: ${intentName}`);

  // APL UserEventを処理（動画終了時の次の動画再生）
  if (requestType === 'Alexa.Presentation.APL.UserEvent') {
    const userEventType = event.request.arguments?.[0];
    const currentIndexArg = event.request.arguments?.[1];

    console.log(`=== PROCESSING USER EVENT ===`);
    console.log(`UserEvent Type: ${userEventType}`);
    console.log(`Current Index Argument:`, currentIndexArg);
    console.log(`Arguments Array:`, event.request.arguments);

    console.log(`Comparing userEventType: "${userEventType}" === "videoEnd": ${userEventType === 'videoEnd'}`);

    if (userEventType === 'videoEnd') {
      console.log(`=== VIDEO END EVENT DETECTED ===`);
      try {
        const bucketName = process.env.BUCKET_NAME;
        console.log(`Bucket Name: ${bucketName}`);

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

        // currentIndexArgから現在のインデックスを取得
        let currentIndex = 0;
        if (typeof currentIndexArg === 'number') {
          currentIndex = currentIndexArg;
        } else if (typeof currentIndexArg === 'string') {
          currentIndex = parseInt(currentIndexArg, 10) || 0;
        } else if (typeof currentIndexArg === 'object' && currentIndexArg !== null) {
          // オブジェクトの場合、様々なプロパティをチェック
          currentIndex = currentIndexArg.value || currentIndexArg.currentIndex || 0;
        }

        console.log(`Current Index: ${currentIndex}`);

        const nextIndex = currentIndex + 1;
        console.log(`Next Index: ${nextIndex}`);
        console.log(`Total videos: ${mp4Files.length}`);

        // 最後の動画を再生し終えた場合はスキルを終了
        if (nextIndex >= mp4Files.length) {
          console.log(`=== PLAYLIST COMPLETED ===`);
          console.log(`All ${mp4Files.length} videos have been played`);

          const endResponse = {
            version: '1.0',
            response: {
              outputSpeech: {
                type: 'PlainText',
                text: 'ポモドーロセッションが完了しました。お疲れ様でした。',
              },
              shouldEndSession: true,
            },
          };
          console.log('=== PLAYLIST END RESPONSE ===');
          console.log(JSON.stringify(endResponse, null, 2));
          return endResponse;
        }

        console.log(`Next Video Key: ${mp4Files[nextIndex]}`);

        if (!mp4Files[nextIndex]) {
          throw new Error(`No video found at index ${nextIndex}`);
        }

        const getCommand = new GetObjectCommand({
          Bucket: bucketName!,
          Key: mp4Files[nextIndex],
        });
        const nextVideoUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
        console.log(`Next Video URL: ${nextVideoUrl}`);

        const aplToken = event.context['Alexa.Presentation.APL']?.token;
        console.log(`APL Token from context: "${aplToken}"`);
        console.log(`Token is empty: ${!aplToken}`);

        // RenderDocumentで新しいビデオを完全にレンダリング
        const renderDirective = {
          type: 'Alexa.Presentation.APL.RenderDocument',
          document: {
            type: 'APL',
            version: '1.8',
            mainTemplate: {
              parameters: [
                'videoData'
              ],
              item: {
                type: 'Video',
                id: 'pomodoroVideo',
                width: '100vw',
                height: '100vh',
                source: nextVideoUrl,
                scale: 'best-fit',
                autoplay: true,
                audioTrack: 'foreground',
                backgroundColor: 'black',
                onEnd: [
                  {
                    type: 'SendEvent',
                    arguments: ['videoEnd', '${videoData.currentIndex}'],
                  },
                ],
              },
            },
          },
          datasources: {
            videoData: {
              currentIndex: nextIndex
            }
          },
        };

        const response = {
          version: '1.0',
          response: {
            directives: [renderDirective],
          },
        };

        console.log('=== VIDEO SWITCH RESPONSE ===');
        console.log(JSON.stringify(response, null, 2));
        return response;
      } catch (error) {
        console.error('Error loading next video:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');

        const errorResponse = {
          version: '1.0',
          response: {
            shouldEndSession: true,
          },
        };
        console.log('=== ERROR RESPONSE ===');
        console.log(JSON.stringify(errorResponse, null, 2));
        return errorResponse;
      }
    } else {
      console.log(`=== USER EVENT TYPE NOT MATCHED ===`);
      console.log(`Expected: "videoEnd", Received: "${userEventType}"`);
      console.log(`Event will not be processed`);
    }

    console.log(`=== USER EVENT PROCESSING COMPLETE ===`);
    return {
      version: '1.0',
      response: {
        shouldEndSession: false,
      },
    };
  }

  if (requestType === 'LaunchRequest' || intentName === 'StartPomodoroIntent') {
    try {
      const bucketName = process.env.BUCKET_NAME;
      console.log(`=== LAUNCH REQUEST ===`);
      console.log(`Bucket Name: ${bucketName}`);

      const command = new ListObjectsV2Command({
        Bucket: bucketName!,
        Prefix: '',
      });

      const objects = await s3Client.send(command);
      const mp4Files = objects.Contents
        ?.filter(obj => obj.Key!.toLowerCase().endsWith('.mp4'))
        .sort((a, b) => a.Key!.localeCompare(b.Key!))
        .map(obj => obj.Key!) || [];

      console.log(`Found MP4 files for launch:`, mp4Files);

      if (mp4Files.length === 0) {
        console.log('No MP4 files found');
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

      console.log(`Generated ${videoUrls.length} video URLs`);
      console.log(`First video URL: ${videoUrls[0]}`);

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
                  parameters: [
                    'videoData'
                  ],
                  item: {
                    type: 'Video',
                    id: 'pomodoroVideo',
                    width: '100vw',
                    height: '100vh',
                    source: videoUrls[0],
                    scale: 'best-fit',
                    autoplay: true,
                    audioTrack: 'foreground',
                    backgroundColor: 'black',
                    onEnd: [
                      {
                        type: 'SendEvent',
                        arguments: ['videoEnd', '${videoData.currentIndex}'],
                      },
                    ],
                  },
                },
              },
              datasources: {
                videoData: {
                  currentIndex: 0
                }
              },
            },
          ],
        },
      };

      console.log('=== LAUNCH RESPONSE ===');
      console.log(JSON.stringify(response, null, 2));
      return response;
    } catch (error) {
      console.error('Launch Error:', error);
      console.error('Launch Error stack:', error instanceof Error ? error.stack : 'No stack trace');
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
      console.log('=== LAUNCH ERROR RESPONSE ===');
      console.log(JSON.stringify(errorResponse, null, 2));
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
  console.log('=== DEFAULT RESPONSE ===');
  console.log(JSON.stringify(defaultResponse, null, 2));
  return defaultResponse;
};
