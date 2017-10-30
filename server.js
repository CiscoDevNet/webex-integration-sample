//
// Copyright (c) 2016 Cisco Systems
// Licensed under the MIT License 
//

/*
 * a Cisco Spark Integration based on nodejs, that acts on user's behalf.
 * implements the Cisco Spark OAuth flow, to retreive Cisco Spark API access tokens.
 * 
 * See documentation: https://developer.ciscospark.com/authentication.html
 * 
 */

var debug = require("debug")("oauth");
var fine = require("debug")("oauth:fine");

var request = require("request");
var express = require('express');
var app = express();


//
// Step 0: create a Spark integration from https://developer.ciscospark.com/add-integration.html
//   - then fill in your Integration properties below
//
var clientId = process.env.CLIENT_ID || "C4ae9568c6cf4576abbc58c183b69f466c6ea6a7d3b8f0f22a60d6775f36d5aed";
var clientSecret = process.env.CLIENT_SECRET || "772c2882806539bee681288640608f5ec2e6afbc11010e74d8bd11c941893096";
var port = process.env.PORT || 8080;
var redirectURI = process.env.REDIRECT_URI || `http://localhost:${port}/oauth`; // where your integration is waiting for Cisco Spark to redirect and send the authorization code
var state = process.env.STATE || "CiscoDevNet"; // state can be used for security and/or correlation purposes
var scopes = "spark:people_read"; // supported scopes are documented at: https://developer.ciscospark.com/add-integration.html, the scopes separator is a space, example: "spark:people_read spark:rooms_read"

//
// Step 1: initiate the OAuth flow
//   - serves a Web page with a link to the Cisco Spark OAuth flow initializer
//
// Initiate the OAuth flow from the 'index.ejs' template  
// ------------------------------------------------------------- 
// -- Comment this section to initiate the flow from  static html page
var initiateURL = "https://api.ciscospark.com/v1/authorize?"
    + "client_id=" + clientId
    + "&response_type=code"
    + "&redirect_uri=" + encodeURIComponent(redirectURI)
    + "&scope=" + encodeURIComponent(scopes)
    + "&state=" + state;
var read = require("fs").readFileSync;
var join = require("path").join;
var str = read(join(__dirname, '/www/index.ejs'), 'utf8');
var ejs = require("ejs");
var compiled = ejs.compile(str)({ "link": initiateURL }); // inject the link into the template
app.get("/index.html", function (req, res) {
    debug("serving the integration home page (generated from an EJS template)");
    res.send(compiled);
});
app.get("/", function (req, res) {
    res.redirect("/index.html");
});

// -------------------------------------------------------------
// Statically serve the "/www" directory
// WARNING: Do not move the 2 lines of code below, as we need this exact precedance order for the static and dynamic HTML generation to work correctly all together
//          If the section above is commented, the static index.html page will be served instead of the EJS template.
var path = require('path');
app.use("/", express.static(path.join(__dirname, 'www')));


//
// Step 2: process OAuth Authorization codes
//
app.get("/oauth", function (req, res) {
    debug("oauth callback hitted");

    // Did the user decline
    if (req.query.error) {
        if (req.query.error == "access_denied") {
            debug("user declined, received err: " + req.query.error);
            res.send("<h1>OAuth Integration could not complete</h1><p>Got your NO, ciao.</p>");
            return;
        }

        if (req.query.error == "invalid_scope") {
            debug("wrong scope requested, received err: " + req.query.error);
            res.send("<h1>OAuth Integration could not complete</h1><p>The application is requesting an invalid scope, Bye bye.</p>");
            return;
        }

        if (req.query.error == "server_error") {
            debug("server error, received err: " + req.query.error);
            res.send("<h1>OAuth Integration could not complete</h1><p>Cisco Spark sent a Server Error, Auf Wiedersehen.</p>");
            return;
        }

        debug("received err: " + req.query.error);
        res.send("<h1>OAuth Integration could not complete</h1><p>Error case not implemented, au revoir.</p>");
        return;
    }

    // Check request parameters correspond to the spec
    if ((!req.query.code) || (!req.query.state)) {
        debug("expected code & state query parameters are not present");
        res.send("<h1>OAuth Integration could not complete</h1><p>Unexpected query parameters, ignoring...</p>");
        return;
    }

    // Check State 
    // [NOTE] we implement a Security check below, but the State variable can also be leveraged for Correlation purposes
    if (state != req.query.state) {
        debug("State does not match");
        res.send("<h1>OAuth Integration could not complete</h1><p>Wrong secret, aborting...</p>");
        return;
    }

    // Retreive access token (expires in 14 days) & refresh token (expires in 90 days)
    //   { 
    //      "access_token":"N2MxMmE0YzgtMjY0MS00MDIxLWFmZDItNTg0MGVkOWEyNWQ3YmMzMmFlODItYzAy",
    //      "expires_in":1209599,
    //      "refresh_token":"NjBjNDk3MjktMjUwMy00YTlkLWJkOTctM2E2MjE3YWU1NmI4Njk3Y2IzODctMjBh",
    //      "refresh_token_expires_in":7775999
    //   }
    var options = {
        method: "POST",
        url: "https://api.ciscospark.com/v1/access_token",
        headers: {
            "content-type": "application/x-www-form-urlencoded"
        },
        form: {
            grant_type: "authorization_code",
            client_id: clientId,
            client_secret: clientSecret,
            code: req.query.code,
            redirect_uri: redirectURI
        }
    };
    request(options, function (error, response, body) {
        if (error) {
            debug("could not reach Cisco Spark to retreive access & refresh tokens");
            res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retreive your access token. Try again...</p>");
            return;
        }

        if (response.statusCode != 200) {
            debug("access token not issued with status code: " + response.statusCode);
            switch (response.statusCode) {
                case 400:
                    var responsePayload = JSON.parse(response.body);
                    res.send("<h1>OAuth Integration could not complete</h1><p>Bad request. <br/>" + responsePayload.message + "</p>");
                    break;
                case 401:
                    res.send("<h1>OAuth Integration could not complete</h1><p>OAuth authentication error. Ask the service contact to check the secret.</p>");
                    break;
                default:
                    res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retreive your access token. Try again...</p>");
                    break;
            }
            return;
        }

        // Check payload
        var json = JSON.parse(body);
        if ((!json) || (!json.access_token) || (!json.expires_in) || (!json.refresh_token) || (!json.refresh_token_expires_in)) {
            debug("could not parse access & refresh tokens");
            res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retreive your access token. Try again...</p>");
            return;
        }
        debug("OAuth flow completed, fetched tokens: " + JSON.stringify(json));
        
        // [Optional] Store tokens for future use
        storeTokens(json.access_token,  json.expires_in, json.refresh_token, json.refresh_token_expires_in);

        // Cisco Spark OAuth flow completed
        oauthFlowCompleted(json.access_token, res);
    });
});


//
// Step 3: this is where the integration runs its custom logic
//   - this function is called as the Cisco Spark OAuth flow has been successfully completed, 
//   - this function is expected to send back an HTML page to the end-user
//   
// some optional activities to perform here: 
//    - associate the issued Spark access token to a user through the state (acting as a Correlation ID)
//    - store the refresh token (valid 90 days) to reissue later a new access token (valid 14 days)
function oauthFlowCompleted(access_token, res) {

    //
    // Custom logic below
    //

    // Retreive user name: GET https://api.ciscospark.com/v1/people/me
    var options = {
        method: 'GET',
        url: 'https://api.ciscospark.com/v1/people/me',
        headers:
        {
            "authorization": "Bearer " + access_token
        }
    };

    request(options, function (error, response, body) {
        if (error) {
            debug("could not reach Cisco Spark to retreive Person's details, error: " + error);
            res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retreive your Cisco Spark account details. Try again...</p>");
            return;
        }

        // Check the call is successful
        if (response.statusCode != 200) {
            debug("could not retreive your details, /people/me returned: " + response.statusCode);
            res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retreive your Cisco Spark account details. Try again...</p>");
            return;
        }

        // Check JSON payload is compliant with specs https://api.ciscospark.com/v1/people/me
        //    {
        //      "id": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS85MmIzZGQ5YS02NzVkLTRhNDEtOGM0MS0yYWJkZjg5ZjQ0ZjQ",
        //      "emails": [
        //        "stsfartz@cisco.com"
        //      ],
        //      "displayName": "Steve Sfartz",
        //      "avatar": "https://1efa7a94ed216783e352-c62266528714497a17239ececf39e9e2.ssl.cf1.rackcdn.com/V1~c2582d2fb9d11e359e02b12c17800f09~aqSu09sCTVOOx45HJCbWHg==~1600",
        //      "created": "2016-02-04T15:46:20.321Z"
        //    }
        var json = JSON.parse(body);
        if ((!json) || (!json.displayName)) {
            debug("could not parse Person details: bad json payload or could not find a displayName.");
            res.send("<h1>OAuth Integration could not complete</h1><p>Sorry, could not retreive your Cisco Spark account details. Try again...</p>");
            return;
        }

        // Uncomment to send feedback via static HTML code 
        //res.send("<h1>OAuth Integration example for Cisco Spark (static HTML)</h1><p>So happy to meet, " + json.displayName + " !</p>");
        // Current code leverages an EJS template:
        var str = read(join(__dirname, '/www/display-name.ejs'), 'utf8');
        var compiled = ejs.compile(str)({ "displayName": json.displayName });        
        res.send(compiled);
    });
}


// The idea here is to store the access token for future use, and the expiration dates and refresh_token to have Cisco Spark issue a new access token
function storeTokens(access_token, expires_in, refresh_token, refresh_token_expires_in) {

    // Store the token in some secure backend
    debug("TODO: store tokens and expiration dates");

    // For demo purpose, we'll NOW ask for a refreshed token
    refreshAccessToken(refresh_token);
}

//
// Example of Refresh token usage
//
function refreshAccessToken(refresh_token) {

    var options = {
        method: "POST",
        url: "https://api.ciscospark.com/v1/access_token",
        headers: {
            "content-type": "application/x-www-form-urlencoded"
        },
        form: {
            grant_type: "refresh_token",
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refresh_token
        }
    };
    request(options, function (error, response, body) {
        if (error) {
            debug("could not reach Cisco Spark to refresh access token");
            return;
        }

        if (response.statusCode != 200) {
            debug("access token not issued with status code: " + response.statusCode);
            return;
        }

        // Check payload
        var json = JSON.parse(body);
        if ((!json) || (!json.access_token) || (!json.expires_in) || (!json.refresh_token) || (!json.refresh_token_expires_in)) {
            debug("could not parse response");
            return;
        }

        // Refresh token obtained
        debug("newly issued tokens: " + JSON.stringify(json));
    });
}


function getLogoutURL(token, redirectURL) {
    var rootURL = redirectURL.substring(0, redirectURL.length - 5);
    return "https://idbroker.webex.com/idb/oauth2/v1/logout?"
        + "goto=" + encodeURIComponent(rootURL)
        + "&token=" + token;
}



// Starts the Cisco Spark Integration
app.listen(port, function () {
    debug("Cisco Spark OAuth Integration started on port: " + port);
});