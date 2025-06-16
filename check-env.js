#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function checkEnvFile(filePath, requiredVars) {
  console.log(`\n🔍 Checking ${filePath}...`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`❌ ${filePath} not found`);
    return false;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  const envVars = {};
  
  lines.forEach(line => {
    const [key, value] = line.split('=');
    if (key && value !== undefined) {
      envVars[key.trim()] = value.trim();
    }
  });

  let isValid = true;
  requiredVars.forEach(varName => {
    if (!envVars[varName] || envVars[varName] === '') {
      console.log(`❌ Missing or empty: ${varName}`);
      isValid = false;
    } else {
      console.log(`✅ ${varName} = ${envVars[varName]}`);
    }
  });

  return isValid;
}

console.log('🚀 Environment Configuration Check\n');

const serverEnv = checkEnvFile('./apps/server/.env', [
  'PORT',
  'CORS_ORIGIN', 
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'DATABASE_URL'
]);

const webEnv = checkEnvFile('./apps/web/.env', [
  'PORT',
  'NEXT_PUBLIC_SERVER_URL'
]);

console.log('\n📝 Summary:');
if (serverEnv && webEnv) {
  console.log('✅ All environment files are properly configured!');
  console.log('\n🎯 Next steps:');
  console.log('   1. Run: npm run db:push');  
  console.log('   2. Run: npm run dev');
} else {
  console.log('❌ Some configuration issues found.');
  console.log('\n💡 To fix:');
  console.log('   1. Run: npm run setup');
  console.log('   2. Edit the .env files as needed');
  console.log('   3. Run this check again: node check-env.js');
} 