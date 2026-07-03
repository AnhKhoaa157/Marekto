// Minimal in-process SMTP capture server for deterministic delivery testing.
//
// This is a real TCP SMTP endpoint: Nodemailer's real SMTP transport connects,
// speaks EHLO/MAIL/RCPT/DATA/QUIT, and the full RFC 5321 envelope + message are
// captured here. It is a test double for an SMTP *provider* only — the client
// transport, connection, and protocol exchange are genuine, not mocked away.
//
// It intentionally advertises no AUTH and no STARTTLS, so it must never be used
// as anything other than a localhost capture sink in tests.
import net from "node:net";

export function startSmtpCaptureServer({ host = "127.0.0.1" } = {}) {
  const messages = [];

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    let inData = false;
    let dataLines = [];
    let mailFrom = null;
    let rcptTo = [];

    const write = (line) => socket.write(`${line}\r\n`);
    write("220 marekto-capture ESMTP ready");

    socket.on("data", (chunk) => {
      buffer += chunk;

      let index;
      while ((index = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);

        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push({
              from: mailFrom,
              to: rcptTo.slice(),
              data: dataLines.join("\n"),
            });
            dataLines = [];
            mailFrom = null;
            rcptTo = [];
            write("250 2.0.0 Ok: queued as CAPTURE");
          } else {
            // Undo transparency dot-stuffing per RFC 5321 section 4.5.2.
            dataLines.push(line.startsWith("..") ? line.slice(1) : line);
          }
          continue;
        }

        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO")) {
          // No AUTH / no STARTTLS advertised: capture sink only.
          write("250-marekto-capture");
          write("250 8BITMIME");
        } else if (upper.startsWith("HELO")) {
          write("250 marekto-capture");
        } else if (upper.startsWith("MAIL FROM")) {
          mailFrom = line.slice(line.indexOf(":") + 1).trim();
          write("250 2.1.0 Ok");
        } else if (upper.startsWith("RCPT TO")) {
          rcptTo.push(line.slice(line.indexOf(":") + 1).trim());
          write("250 2.1.5 Ok");
        } else if (upper.startsWith("DATA")) {
          inData = true;
          dataLines = [];
          write("354 End data with <CR><LF>.<CR><LF>");
        } else if (upper.startsWith("RSET")) {
          mailFrom = null;
          rcptTo = [];
          write("250 2.0.0 Ok");
        } else if (upper.startsWith("QUIT")) {
          write("221 2.0.0 Bye");
          socket.end();
        } else if (upper.startsWith("NOOP")) {
          write("250 2.0.0 Ok");
        } else {
          write("250 2.0.0 Ok");
        }
      }
    });

    socket.on("error", () => {
      // Ignore client-side resets after QUIT; nothing to capture.
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      resolve({
        host,
        port,
        messages,
        close: () =>
          new Promise((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}
