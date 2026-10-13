import "./globals.css";

export const metadata = {
  title: "TRAZANO — Trazabilidad del tabaco salteño",
  description: "Cadena de custodia onchain y FET transparente · Monad",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <nav>
          <a href="/" className="brand">
            TRAZANO<span>· trazabilidad tabaco</span>
          </a>
          <div className="navlinks">
            <a href="/">Inspector</a>
            <a href="/acciones">Acciones</a>
            <a href="/lote/6">Pack público</a>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
