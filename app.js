const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const archiver = require("archiver");

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const TOKEN_PATH = 'token.json';
const ZLIB_COMPRESSION_LEVEL = 5;

manageArchive();
manageUpload();

function manageUpload() {
  const credentials = require("./credentials.json");
  authorize(credentials, auth => {
    const drive = google.drive({version: 'v3', auth});

    listFiles(drive, files => {
      console.log("=== START ===");
      const fileNames = files.filter(file => !file.trashed).map(file => file.name);
      if (fileNames.includes("DockerBackups")) {
        const id = files[fileNames.indexOf("DockerBackups")].id;
        console.log(` > Found folder DockerBackups | ID is ${id}`);
        uploadFiles(drive, id);
        console.log(" > Files uplodaed !");
        console.log("=== END ===");
      } else {
        createAFolderAndManageFileUpload(drive);
      }
    })
  });
}

function manageArchive() {
  const output = fs.createWriteStream(__dirname + `/data/archive.zip`);
  const archive = archiver("zip", {
    zlib: { level: ZLIB_COMPRESSION_LEVEL }
  });

  console.log("=== ARCHIVING ===");
  archive.pipe(output);

  /** @type Array */
  const toArchive = require("./toArchive");
  toArchive.forEach(entry => {
    console.log(` > Archiving : ${entry.path} > ${entry.destinationPath}`)
    if (entry.type === "directory") {
      archive.directory(entry.path, entry.destinationPath);
    } else {
      if (typeof entry.path === "object") {
        entry.path.forEach(path => {
          archive.file(path, {name: entry.destinationPath + "/" + path.split("/").pop() });
        })
      } else {
        archive.file(entry.path, {name: entry.destinationPath + "/" + path.split("/").pop() });
      }
    }
  })

  archive.finalize();
  console.log("=== ARCHIVING DONE ===");
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error retrieving access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

function uploadFiles(drive, folderId = null) {
  /** @type Array */
  let filesArray = require("./files.json").map(file => {
    let obj = {
      resource: {
        "name": file.name.replace("%TIMESTAMP%", Date.now())
      },
      media: {
        mimeType: file.mimeType,
        body: fs.createReadStream(file.path)
      },
      fields: "id"
    }
    if (folderId) {
      obj.resource.parents = [folderId]
    }
    return obj
  })
  filesArray.forEach(myFile => {
    drive.files.create(myFile, (err, file) => {
      if (err) {
        return console.error(err);
      }
      console.log(` > Uploaded ${myFile.resource.name}`)
    })
  })
}

function createFolder(drive, folderName, folderId = null, callback) {
  let fileMetadata = {
    "name": folderName,
    "mimeType": "application/vnd.google-apps.folder"
  }
  if (folderId) {
    fileMetadata.parents = [folderId]
  }
  drive.files.create({
    resource: fileMetadata,
    fields: "id"
  }, (err, folder) => {
    if (err) {
      return console.error(err);
    }
    callback(folder.data.id)
  })
}

function listFiles(drive, callback) {
  drive.files.list({
    fields: 'nextPageToken, files(id, name, trashed)'
  }, (err, res) => {
    if (err) return console.error('The API returned an error: ' + err);
    const files = res.data.files;
    if (files.length) {
      callback(files)
    } else {
      console.log('No files found.');
    }
  });
}

function createAFolderAndManageFileUpload(drive) {
  console.log(" > Creating a folder...");
  createFolder(drive, "DockerBackups", null, id => {
    console.log(` > Folder created. Id is ${id}`);
    uploadFiles(drive, id);
    console.log(" > Files uplodaed !");
    console.log("=== END ===");
  });
}