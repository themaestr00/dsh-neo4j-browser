import {build} from 'esbuild';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('.',import.meta.url));
const result=await build({
  absWorkingDir:root,entryPoints:['src/client.js'],outfile:'dist/client.js',
  bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,
  legalComments:'eof',metafile:true,
  banner:{js:'/* Neo4j Browser Client. Bundled dependencies: see THIRD_PARTY_NOTICES.txt. */'},
});
const inputs=Object.keys(result.metafile.inputs);
if(inputs.some(path=>/node_modules\/(?:react(?:-dom)?\/|@deepseek-ai\/)/.test(path)))throw new Error('React and Harness Client packages must not be bundled.');
if(Object.values(result.metafile.outputs).some(output=>output.imports.length))throw new Error('The browser artifact must be self-contained.');
const packages=new Map();
for(const input of inputs.filter(path=>path.includes('node_modules/'))) {
  let directory=dirname(resolve(root,input));
  while(directory.startsWith(root.endsWith(sep)?root:root+sep)) {
    const manifest=join(directory,'package.json');
    if(existsSync(manifest)) {
      const pkg=JSON.parse(readFileSync(manifest,'utf8'));
      if(!packages.has(pkg.name)) {
        const license=['LICENSE','LICENSE.txt','LICENSE.md','license'].map(name=>join(directory,name)).find(existsSync);
        if(!license)throw new Error('Missing bundled dependency license: '+pkg.name);
        packages.set(pkg.name,`${pkg.name}@${pkg.version} (${pkg.license||'see license below'})\n${readFileSync(license,'utf8')}`);
      }
      break;
    }
    directory=dirname(directory);
  }
}
mkdirSync(join(root,'dist'),{recursive:true});
writeFileSync(join(root,'dist/THIRD_PARTY_NOTICES.txt'),[...packages.values()].sort().join('\n\n----------------------------------------\n\n'));
console.log(`Built dist/client.js with ${packages.size} bundled dependency license notices; no React, Harness Client imports or external browser requests.`);
