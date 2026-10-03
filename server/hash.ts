import argon2 from 'argon2';

async function generate() {
    const hash = await argon2.hash('St123101', { type: argon2.argon2id });
    console.log(hash);
}
generate();