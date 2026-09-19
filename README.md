# cs:go server finder (vercel ready)

a clean, all-lowercase, pure black-and-white web interface for querying and discovering cs:go / cs2 servers directly from valve's steam master servers.

## features
- **minimal monochrome design**: pure black (`#000000`) and white (`#ffffff`) theme with monospace typography accents.
- **strict lowercase**: clean aesthetic styled entirely in lowercase.
- **steam web api integration**: queries `IGameServersService/GetServerList/v1/` to filter servers by build version, region, and game mode.
- **obfuscated steam api key**: encoded into bytecode and reconstructed in memory at runtime—no plaintext 32-hex key string appears in the repository or static html.
- **instant copy buttons**: one-click copy for server ip (`ip:port`), console connect command (`connect ip:port`), and direct steam client launcher (`steam://connect/`).
- **smooth micro-animations**: subtle card entrances, pulsing status indicator, toast notifications, and copy button state transitions.
- **instant client-side search**: filter loaded servers by map name (e.g. `de_mirage`, `de_dust2`), server name, or ip in real-time.
- **built-in cors mitigation**:
  - configured with `vercel.json` edge rewrites for vercel deployments.
  - includes `api/servers.js` serverless proxy function.
  - includes automatic fallback to cors proxy for local / static file testing.

## quick start (local)

to test locally, you can start a lightweight http server:

```bash
# using python 3
python -m http.server 3000
```
then open `http://localhost:3000` in your browser.

## deploying to vercel

### option 1: vercel cli
run the following command in this directory:
```bash
npx vercel
```

### option 2: github / vercel dashboard
1. push this directory to a github repository.
2. go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. leave the build settings at default (static HTML / zero-config).
4. click **deploy**.

vercel will automatically read `vercel.json` and proxy `/api/steam` directly to valve's server list service without any cors errors.

## updating servers without redeploying

the website dynamically reads its server list from your live github gist:
👉 **[https://gist.github.com/kanok22/ba7c6e99ef241f958e12306128246e1b](https://gist.github.com/kanok22/ba7c6e99ef241f958e12306128246e1b)**

1. open the gist link above in any browser or on your phone.
2. click **edit**.
3. add, remove, or modify any server `ip:port` in the json array.
4. click **update gist**.

the website at [www.hvhlegacy.info](https://www.hvhlegacy.info) automatically polls and renders the updated list within ~30 seconds. **no code uploads or vercel redeployments required.**
