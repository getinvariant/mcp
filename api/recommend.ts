export default function handler(_req: any, res: any) {
  return res.status(410).json({
    error:
      "This endpoint has been removed. Use the recommend MCP tool instead.",
    migration:
      "Call the 'recommend' tool via POST /api/mcp using the MCP protocol.",
  });
}
