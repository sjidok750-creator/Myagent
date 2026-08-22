/**
 * 웹 푸시용 VAPID 키 쌍을 만든다.
 *
 *   npm run vapid
 *
 * 나온 값을 배포 환경변수에 넣으면 헤뤼싀가 먼저 말을 걸 수 있다.
 * 개인키는 절대 공개 저장소에 커밋하지 않는다.
 */

import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('\n배포 환경변수에 아래 세 줄을 넣으세요.\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:본인이메일@example.com');
console.log('\n개인키는 커밋하지 마세요. 새로 만들면 기존 구독은 모두 무효가 됩니다.\n');
