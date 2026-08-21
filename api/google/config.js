/**
 * 브라우저가 인증을 시작하는 데 필요한 공개 정보.
 * 클라이언트 ID 는 공개해도 되는 값이다. 시크릿은 절대 내보내지 않는다.
 */

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET 만 지원합니다.' });
  }
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    enabled: !!(clientId && process.env.GOOGLE_CLIENT_SECRET),
    clientId,
  });
}
