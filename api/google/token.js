/**
 * 구글 OAuth 토큰 중계.
 *
 * 브라우저는 클라이언트 시크릿을 가질 수 없으므로 교환·갱신만 서버가 대신한다.
 * 발급된 토큰은 응답으로 돌려줄 뿐, 서버는 저장하지 않는다. 보관은 기기가 한다.
 *
 *   POST { grant: 'code',    code, code_verifier, redirect_uri }
 *   POST { grant: 'refresh', refresh_token }
 *   POST { grant: 'revoke',  token }
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 만 지원합니다.' });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: '서버에 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 이 없습니다. 배포 환경변수를 확인해 주세요.',
    });
  }

  const required = process.env.ACCESS_CODE;
  if (required && req.headers['x-access-code'] !== required) {
    return res.status(401).json({ error: '접속 코드가 맞지 않습니다.' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: '요청 본문을 읽을 수 없습니다.' });
  }

  try {
    if (body.grant === 'revoke') {
      if (!body.token) return res.status(400).json({ error: 'token 이 없습니다.' });
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: String(body.token) }),
      });
      return res.status(200).json({ ok: true });
    }

    const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });

    if (body.grant === 'code') {
      if (!body.code || !body.code_verifier || !body.redirect_uri) {
        return res.status(400).json({ error: 'code / code_verifier / redirect_uri 가 필요합니다.' });
      }
      params.set('grant_type', 'authorization_code');
      params.set('code', String(body.code));
      params.set('code_verifier', String(body.code_verifier));
      params.set('redirect_uri', String(body.redirect_uri));
    } else if (body.grant === 'refresh') {
      if (!body.refresh_token) return res.status(400).json({ error: 'refresh_token 이 없습니다.' });
      params.set('grant_type', 'refresh_token');
      params.set('refresh_token', String(body.refresh_token));
    } else {
      return res.status(400).json({ error: '알 수 없는 grant 입니다.' });
    }

    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.error('[herushi] google token', r.status, data?.error, data?.error_description);
      return res.status(r.status).json({
        error: googleError(data),
        code: data?.error,
      });
    }

    return res.status(200).json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,     // 갱신 때는 안 올 수 있다
      expires_in: data.expires_in,
      scope: data.scope,
      token_type: data.token_type,
    });
  } catch (err) {
    console.error('[herushi] google token 오류', err?.message);
    return res.status(502).json({ error: '구글 인증 서버에 연결하지 못했습니다.' });
  }
}

function googleError(data) {
  const e = data?.error;
  if (e === 'invalid_grant') return '구글 연결이 만료되었습니다. 설정에서 다시 연결해 주세요.';
  if (e === 'redirect_uri_mismatch') {
    return '구글 클라우드에 등록한 리디렉션 주소와 다릅니다. 승인된 리디렉션 URI 를 확인해 주세요.';
  }
  if (e === 'invalid_client') return '구글 클라이언트 ID/시크릿이 올바르지 않습니다.';
  return data?.error_description || data?.error || '구글 인증에 실패했습니다.';
}
