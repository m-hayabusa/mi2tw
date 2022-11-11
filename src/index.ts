import { webHookBody } from "./webHookBody";

export interface Env {
	mi2tw_Auth: KVNamespace;
	mi2tw_Uid: KVNamespace;
	URL: string;
	client_id: string;
}

async function gatherResponse(response: Response) {
	const { headers } = response;
	const contentType = headers.get('content-type') || '';
	if (contentType.includes('application/json')) {
		return JSON.stringify(await response.json());
	}
	return response.text();
}

async function refresh(uid: string, token: string, env: Env): Promise<string> {
	const params = new URLSearchParams();
	params.append("grant_type", "refresh_token");
	params.append("client_id", env.client_id);
	params.append("refresh_token", token);

	const res = await gatherResponse(await fetch("https://api.twitter.com/2/oauth2/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		},
		body: params
	}));


	const data = JSON.parse(res) as { token_type: string, expires_in: number, access_token: string, scope: string, refresh_token: string };

	console.log("refresh", res);
	if (data.access_token && data.expires_in && data.refresh_token)
		env.mi2tw_Auth.put(uid, JSON.stringify({ "access_token": data.access_token, "vaild_until": Date.now() + data.expires_in * 60, "refresh_token": data.refresh_token }));
	else
		throw new Error("Refresh Failed");

	return data.access_token;
}

async function revoke(uid: string, env: Env) {
	const res = await env.mi2tw_Auth.get(uid);
	if (res) {
		const user = await (await fetch("https://api.twitter.com/2/users/me", {
			method: 'GET',
			headers: {
				"Content-type": "application/json",
				"Authorization": `Bearer ${JSON.parse(res).access_token}`
			}
		})).json<{ data: { "id": number, "name": string, "username": string } }>();

		env.mi2tw_Uid.delete(user.data.id.toString());

		const params = new URLSearchParams();
		params.append("client_id", env.client_id);
		params.append("token", JSON.parse(res).access_token);

		await fetch("https://api.twitter.com/2/oauth2/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded"
			},
			body: params
		});

		env.mi2tw_Auth.delete(uid);
	}
}

async function auth(code: string, env: Env): Promise<Response> {
	const params = new URLSearchParams();
	params.append("code", code);
	params.append("grant_type", "authorization_code");
	params.append("client_id", env.client_id);
	params.append("redirect_uri", `${env.URL}/callback`);
	params.append("code_verifier", "challenge");

	const data = await (await fetch("https://api.twitter.com/2/oauth2/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		},
		body: params
	})).json<{ token_type: string, expires_in: number, access_token: string, scope: string, refresh_token: string }>();

	console.log("auth", JSON.stringify(data));

	if (data.access_token) {
		const user = await (await fetch("https://api.twitter.com/2/users/me", {
			method: 'GET',
			headers: {
				"Content-type": "application/json",
				"Authorization": `Bearer ${data.access_token}`
			}
		})).json<{ data: { "id": number, "name": string, "username": string } }>();

		let uid = await env.mi2tw_Uid.get(user.data.id.toString());
		if (uid == undefined) {
			uid = crypto.randomUUID();
			await env.mi2tw_Uid.put(user.data.id.toString(), uid);
		}
		await env.mi2tw_Auth.put(uid, JSON.stringify({ "access_token": data.access_token, "vaild_until": Date.now() + data.expires_in * 60, "refresh_token": data.refresh_token }));

		const result = new Response(`<meta charset='utf-8'>これをMisskey側WebhookのURLに入力: <input type="text" readonly value="${env.URL}"></input><br>これをMisskey側WebhookのSecretに入力: <input id="uid" type="text" readonly value="${uid}"></input><br><a href="./revoke?uid=${uid}"><button>アクセスキーを削除</button></a>`);
		result.headers.append("Content-type", "text/html");
		return result;
	} else {
		return new Response("認証に失敗しました");
	}
}

async function tweet(webHook: webHookBody, uid: string, env: Env): Promise<void> {
	const note = webHook.body.note;

	if (webHook.type === "note" && note.renoteId == undefined && note.replyId == undefined && note.cw == undefined && note.localOnly != true && note.text && /\#mi2tw/.test(note.text)) {
		console.log("tw", uid);
		const key = await env.mi2tw_Auth.get(uid);
		console.log(key);
		if (!key) return;
		const res = JSON.parse(key) as { "access_token": string, "vaild_until": number, "refresh_token": string };
		const token = res.vaild_until - 1000 < Date.now() ? await refresh(uid, res.refresh_token, env) : res.access_token;
		// const token = await refresh(uid, res.refresh_token, env);

		console.log("tweet", await gatherResponse(await fetch("https://api.twitter.com/2/tweets", {
			method: 'POST',
			headers: {
				"Content-type": "application/json",
				"Authorization": `Bearer ${token}`
			},
			body: JSON.stringify({
				"text": `${note.text}`,
			})
		})));
	}
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "POST") {
			const uid = request.headers.get("x-misskey-hook-secret");
			if (uid) {
				const webHook = await request.json<webHookBody>();
				await tweet(webHook, uid, env);
				return new Response();
			}
		} else if (url.pathname === "/callback") {
			const code = url.searchParams.get("code");
			if (code) {
				return await auth(code, env);
			}
		} else if (url.pathname === "/revoke") {
			const uid = url.searchParams.get("uid");
			if (uid) {
				await revoke(uid, env);
				return new Response("削除しました");
			}
		}

		const res = new Response(`<meta charset='utf-8'><h1>MisskeyのWebhook使って投稿をTwitterに転送するやつ</h1><br>(ローカル限定でない、#mi2tw がついてる、リプライでない、リノートでない、CWもついてない投稿のみ)<br><a href='https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${env.client_id}&redirect_uri=${env.URL}/callback&scope=offline.access%20users.read%20tweet.read%20tweet.write&state=state&code_challenge=challenge&code_challenge_method=plain'>ここで認証</a>`);
		res.headers.append("Content-type", "text/html");
		return res;
	},
};
