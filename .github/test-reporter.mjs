// node --test reporter for CI: each failing test as a GitHub annotation, which anyone can read
// through the API and the pull request (a job's logs need a login).
export default async function* annotations(source) {
  for await (const event of source) {
    if (event.type !== "test:fail" || event.data.details?.type === "suite") continue;
    const { name, file, details } = event.data;
    const error = details?.error?.cause ?? details?.error;
    const message = `${error?.message ?? error ?? "failed"}\n${error?.stack ?? ""}`.slice(0, 4000);
    // workflow commands escape %, CR and LF; properties also , and :
    const escape = (text) => String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    const title = escape(name).replace(/,/g, "%2C").replace(/:/g, "%3A");
    yield `::error title=${title}${file ? `,file=${escape(file).replace(/,/g, "%2C").replace(/:/g, "%3A")}` : ""}::${escape(message)}\n`;
  }
}
