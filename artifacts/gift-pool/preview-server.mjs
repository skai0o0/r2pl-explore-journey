import { createServer } from 'vite';
const server=await createServer({configFile:false,root:process.cwd(),cacheDir:'.vite/gift-pool-preview',server:{host:'127.0.0.1',port:4318,strictPort:true}});
await server.listen();server.printUrls();
