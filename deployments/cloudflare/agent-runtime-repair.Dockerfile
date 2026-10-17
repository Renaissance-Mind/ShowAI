# Repair public runtime permissions on the exact previously verified image.
FROM registry.cloudflare.com/8f1753ad2d5e392716033248d7c5639e/showai-agent-showaiagentgateway@sha256:11b21ea90256f85c79e047228051f1bdf438c6f845b00adcbb9b2d6a83dca80f
USER root
RUN find /app -type d ! -perm -005 -exec chmod a+rx {} + && find /app -type f ! -perm -004 -exec chmod a+r {} +
USER node
RUN node --input-type=module -e "import {readdir,readFile} from 'node:fs/promises';import {join} from 'node:path';async function walk(p){for(const e of await readdir(p,{withFileTypes:true})){const q=join(p,e.name);if(e.isDirectory())await walk(q);else await readFile(q);}}await walk('/app/assets/agent-plugin');console.log('Bundled plugin readable as runtime user');"
RUN node /app/scripts/content-check.mjs
