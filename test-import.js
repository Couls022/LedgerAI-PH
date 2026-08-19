async function run() {
  try {
    await import('fs-extra-does-not-exist');
  } catch (err) {
    console.error(err);
  }
}
run();
