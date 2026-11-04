import argon2 from 'argon2';

async function generate() {
    const hash = await argon2.hash('MetaTest2026', { type: argon2.argon2id });
    console.log(hash);
}
generate();
// EXECUTE COM O COMANDO: npx tsx hash.ts