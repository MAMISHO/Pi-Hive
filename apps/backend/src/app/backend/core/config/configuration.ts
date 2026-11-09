export default () => {
  const conf = {
    port: parseInt(process.env.PORT ?? '8090', 10),
    debugPort: parseInt(process.env.DEBUG_PORT ?? '9230', 10),
    dbPath: process.env.DB_PATH ?? './data/pi-hive.db',
    engramBaseDir: process.env.ENGRAM_BASE_DIR ?? './data/memories',
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
  return conf;
};