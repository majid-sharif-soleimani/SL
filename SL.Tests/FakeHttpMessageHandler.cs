using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

internal class FakeHttpMessageHandler : HttpMessageHandler
{
    private readonly HttpResponseMessage _response;
    private readonly Func<HttpRequestMessage, HttpResponseMessage> _responseFactory;

    public FakeHttpMessageHandler(HttpResponseMessage response)
    {
        _response = response;
        _responseFactory = _ => response;
    }

    public FakeHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> responseFactory)
    {
        _response = new HttpResponseMessage(HttpStatusCode.InternalServerError);
        _responseFactory = responseFactory;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        return Task.FromResult(_responseFactory(request));
    }
}
