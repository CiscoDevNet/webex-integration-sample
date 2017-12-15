module.exports = function oauthFlowCompleted (access_token, res) {

    // Demo Space Id
    // This demo assumes the Spark user behind the token is part of the space 
    const roomId = process.env.SPACE_ID;
    
    // Uncomment to send feedback via static HTML code 
    //res.send("<h1>OAuth Integration example for Cisco Spark (static HTML)</h1><p>So happy to meet, " + json.displayName + " !</p>");
    // Current code leverages an EJS template:
    var read = require("fs").readFileSync;
    var join = require("path").join;
    var str = read(join(__dirname, './widget.ejs'), 'utf8');
    var ejs = require("ejs");
    var compiled = ejs.compile(str)({
        "token": access_token,
        "spaceId": roomId
    });

    res.send(compiled);
}