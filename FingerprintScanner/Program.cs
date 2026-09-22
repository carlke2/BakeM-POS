using System.Net;
using System.Text;
using System.Text.Json;

var port = int.TryParse(Environment.GetEnvironmentVariable("FINGERPRINT_PORT"), out var p) ? p : 17890;
var corsOrigins = ParseCorsOrigins(
    Environment.GetEnvironmentVariable("FINGERPRINT_CORS_ORIGIN"),
    "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,https://betterfork.millenium.co.ke");

using var device = new FingerprintDevice();
var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

Console.WriteLine("SmartPOS Fingerprint Scanner Service");
Console.WriteLine($"Listening on http://127.0.0.1:{port}");
Console.WriteLine("Endpoints: GET /health  POST /prepare  POST /capture  POST /check-duplicate");
Console.WriteLine($"CORS origins: {string.Join(", ", corsOrigins)}\n");

if (device.Initialize())
{
    Console.WriteLine($"Scanner ready ({device.DeviceCount} device(s) detected)\n");
}
else
{
    Console.WriteLine($"Warning: {device.LastError ?? "Scanner not ready"} - service will retry on capture\n");
}

using var listener = new HttpListener();
// Prefer wildcard prefix when reserved (see register-url.ps1). Matches existing ACL on many setups.
var prefixes = new[] { $"http://+:{port}/", $"http://127.0.0.1:{port}/" };
HttpListenerException? lastError = null;

foreach (var prefix in prefixes)
{
    listener.Prefixes.Clear();
    listener.Prefixes.Add(prefix);
    try
    {
        listener.Start();
        Console.WriteLine($"Bound to {prefix}\n");
        lastError = null;
        break;
    }
    catch (HttpListenerException ex) when (ex.ErrorCode == 5)
    {
        lastError = ex;
    }
}

if (lastError != null)
{
    Console.Error.WriteLine("\nFailed to start HTTP listener (Access denied).");
    Console.Error.WriteLine("Run PowerShell AS ADMINISTRATOR once from the fingerprintScanner folder:");
    Console.Error.WriteLine("  .\\register-url.ps1");
    Console.Error.WriteLine("\nOr manually:");
    Console.Error.WriteLine($"  netsh http add urlacl url=http://+:{port}/ user={Environment.UserName}");
    return 1;
}

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};

try
{
    while (!cts.Token.IsCancellationRequested)
    {
        var contextTask = listener.GetContextAsync();
        var completed = await Task.WhenAny(contextTask, Task.Delay(Timeout.Infinite, cts.Token));
        if (completed != contextTask) break;

        var context = await contextTask;
        _ = Task.Run(() => HandleRequest(context, device, jsonOptions, corsOrigins), cts.Token);
    }
}
finally
{
    listener.Stop();
    Console.WriteLine("\nScanner service stopped.");
}

return 0;

static void HandleRequest(HttpListenerContext context, FingerprintDevice device, JsonSerializerOptions jsonOptions, HashSet<string> corsOrigins)
{
    var request = context.Request;
    var response = context.Response;

    try
    {
        AddCors(request, response, corsOrigins);

        if (request.HttpMethod == "OPTIONS")
        {
            response.StatusCode = 204;
            response.Close();
            return;
        }

        var path = request.Url?.AbsolutePath.TrimEnd('/') ?? "";

        if (request.HttpMethod == "GET" && path == "/health")
        {
            WriteJson(response, 200, new
            {
                ok = true,
                deviceConnected = device.IsReady || device.Initialize(),
                deviceCount = device.DeviceCount,
                message = device.LastError,
            }, jsonOptions);
            return;
        }

        if (request.HttpMethod == "POST" && path == "/prepare")
        {
            var ready = device.Prepare();
            WriteJson(response, ready ? 200 : 503, new
            {
                ok = ready,
                deviceConnected = device.IsReady,
                message = ready ? "Scanner ready" : device.LastError,
            }, jsonOptions);
            return;
        }

        if (request.HttpMethod == "POST" && path == "/check-duplicate")
        {
            using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
            var body = reader.ReadToEnd();
            var payload = JsonSerializer.Deserialize<DuplicateCheckRequest>(body, jsonOptions);

            if (payload?.Template == null || payload.Candidates == null)
            {
                WriteJson(response, 422, new { ok = false, message = "template and candidates are required" }, jsonOptions);
                return;
            }

            byte[] candidate;
            try
            {
                candidate = Convert.FromBase64String(payload.Template);
            }
            catch
            {
                WriteJson(response, 422, new { ok = false, message = "Invalid template encoding" }, jsonOptions);
                return;
            }

            var existing = new List<byte[]>();
            foreach (var encoded in payload.Candidates)
            {
                if (string.IsNullOrWhiteSpace(encoded)) continue;
                try
                {
                    existing.Add(Convert.FromBase64String(encoded));
                }
                catch
                {
                    WriteJson(response, 422, new { ok = false, message = "Invalid candidate template encoding" }, jsonOptions);
                    return;
                }
            }

            var (isDuplicate, matchedIndex, score) = device.FindDuplicate(candidate, existing);
            WriteJson(response, 200, new
            {
                ok = true,
                isDuplicate,
                matchedIndex = isDuplicate ? matchedIndex : (int?)null,
                score = isDuplicate ? score : 0,
            }, jsonOptions);
            return;
        }

        if (request.HttpMethod == "POST" && path == "/capture")
        {
            var timeoutSec = 15;
            var q = request.QueryString["timeout"];
            if (int.TryParse(q, out var parsed) && parsed >= 5 && parsed <= 60)
                timeoutSec = parsed;

            Console.WriteLine($"Capture requested (timeout {timeoutSec}s) - place finger on scanner...");
            var captured = device.Capture(TimeSpan.FromSeconds(timeoutSec));

            if (captured == null)
            {
                WriteJson(response, 503, new
                {
                    ok = false,
                    message = device.LastError ?? "Failed to capture fingerprint",
                }, jsonOptions);
                return;
            }

            var (template, size) = captured.Value;
            var base64 = Convert.ToBase64String(template);
            Console.WriteLine($"Fingerprint captured ({size} bytes)");

            WriteJson(response, 200, new
            {
                ok = true,
                template = base64,
                size,
            }, jsonOptions);
            return;
        }

        WriteJson(response, 404, new { ok = false, message = "Not found" }, jsonOptions);
    }
    catch (Exception ex)
    {
        WriteJson(response, 500, new { ok = false, message = ex.Message }, jsonOptions);
    }
}

static HashSet<string> ParseCorsOrigins(string? configured, string defaults)
{
    var raw = string.IsNullOrWhiteSpace(configured) ? defaults : configured;
    return raw
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);
}

static void AddCors(HttpListenerRequest request, HttpListenerResponse response, HashSet<string> allowedOrigins)
{
    var requestOrigin = request.Headers["Origin"];
    var allowOrigin = !string.IsNullOrWhiteSpace(requestOrigin) && allowedOrigins.Contains(requestOrigin)
        ? requestOrigin
        : allowedOrigins.FirstOrDefault() ?? "http://localhost:5173";

    response.Headers.Add("Access-Control-Allow-Origin", allowOrigin);
    response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.Headers.Add("Access-Control-Allow-Headers", "Content-Type");
    response.Headers.Add("Vary", "Origin");
}

static void WriteJson(HttpListenerResponse response, int statusCode, object payload, JsonSerializerOptions options)
{
    var json = JsonSerializer.Serialize(payload, options);
    var buffer = Encoding.UTF8.GetBytes(json);
    response.StatusCode = statusCode;
    response.ContentType = "application/json";
    response.ContentEncoding = Encoding.UTF8;
    response.ContentLength64 = buffer.Length;
    response.OutputStream.Write(buffer, 0, buffer.Length);
    response.Close();
}

file sealed class DuplicateCheckRequest
{
    public string? Template { get; set; }
    public List<string>? Candidates { get; set; }
}
