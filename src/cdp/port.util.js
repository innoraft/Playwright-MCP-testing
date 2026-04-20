import net from 'net';
/**
 * Finds a free TCP port on localhost.
 * @returns {Promise<number>} A free port number
 */
export async function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}
