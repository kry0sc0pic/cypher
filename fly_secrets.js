const vars = require('dotenv').config()['parsed'];
const { exec } = require("child_process");
Object.keys(vars).forEach((key, i) => {
  // console.log(i,item);
  let k = key;
  let v = vars[key];
  console.log(`Setting Secret ${i+1} -> ${k}`);
  exec(`flyctl secrets set ${k}=${v}`);


});

console.log('\n Set Secrets\n');
exec('flyctl secrets list',(_,out,err)=>{
  console.log('flyctl output\n\n');
  console.log(out);
});
