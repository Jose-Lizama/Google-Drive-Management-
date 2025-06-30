/**
 * OppCO Drive Management System - Google Apps Script Backend
 */

// Configuration
var CONFIG = {
  DOMAIN: '',
  LOG_SHEET_ID: '',
  LOG_SHEET_NAME: '',
  MAX_ITEMS_PER_FOLDER: 100,
  ADMIN_EMAILS: ['']
};

/**
 * Serves the HTML web app
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Gets all Google Workspace users in the domain
 */
function getAllWorkspaceUsers() {
  try {
    console.log('Starting getAllWorkspaceUsers...');
    console.log('Domain: ' + CONFIG.DOMAIN);
    
    if (typeof AdminDirectory === 'undefined') {
      throw new Error('Admin SDK API not enabled');
    }
    
    var users = [];
    var pageToken = null;
    
    do {
      console.log('Making Admin Directory API call...');
      
      var requestOptions = {};
      requestOptions.domain = CONFIG.DOMAIN;
      requestOptions.maxResults = 500;
      requestOptions.orderBy = 'givenName';
      if (pageToken) {
        requestOptions.pageToken = pageToken;
      }
      
      var response = AdminDirectory.Users.list(requestOptions);
      console.log('API Response received');
      
      if (response.users) {
        for (var i = 0; i < response.users.length; i++) {
          var user = response.users[i];
          if (!user.suspended && user.primaryEmail) {
            var userObj = {};
            userObj.primaryEmail = user.primaryEmail;
            userObj.name = user.name;
            userObj.id = user.id;
            userObj.orgUnitPath = user.orgUnitPath;
            users.push(userObj);
          }
        }
      }
      
      pageToken = response.nextPageToken;
    } while (pageToken);
    
    console.log('Retrieved ' + users.length + ' workspace users');
    return users;
    
  } catch (error) {
    console.error('Error getting workspace users: ' + error.toString());
    
    if (error.toString().indexOf('Admin SDK API not enabled') > -1) {
      throw new Error('Admin SDK API is not enabled. Please add it in Services with identifier AdminDirectory.');
    } else if (error.toString().indexOf('insufficient permissions') > -1) {
      throw new Error('Insufficient permissions. You must be a Google Workspace Admin to use this feature.');
    } else if (error.toString().indexOf('domain') > -1) {
      throw new Error('Domain ' + CONFIG.DOMAIN + ' not found or not accessible. Please check your domain setting.');
    } else {
      throw new Error('Failed to retrieve workspace users: ' + error.message);
    }
  }
}

/**
 * Gets the drive structure for a specific user
 */
function getUserDriveStructure(userEmail) {
  try {
    console.log('Getting drive structure for: ' + userEmail);
    
    if (!isValidEmail(userEmail)) {
      throw new Error('Invalid email address provided');
    }
    
    var driveData = {};
    driveData.drives = [];
    driveData.error = null;
    
    var drives = getUserDrives(userEmail);
    console.log('Found ' + drives.length + ' drives for user');
    
    for (var i = 0; i < drives.length; i++) {
      var drive = drives[i];
      console.log('Processing drive: ' + drive.name);
      
      var driveInfo = {};
      driveInfo.id = drive.id;
      driveInfo.name = drive.name;
      driveInfo.type = drive.type;
      driveInfo.folders = [];
      driveInfo.files = [];
      
      var items = getDriveItems(drive.id, userEmail);
      
      for (var j = 0; j < items.folders.length; j++) {
        var folder = items.folders[j];
        var folderInfo = {};
        folderInfo.id = folder.id;
        folderInfo.name = folder.name;
        folderInfo.owner = folder.owner;
        folderInfo.files = getFolderFiles(folder.id, userEmail);
        driveInfo.folders.push(folderInfo);
      }
      
      driveInfo.files = items.files;
      driveData.drives.push(driveInfo);
    }
    
    console.log('Drive structure retrieved successfully');
    return driveData;
    
  } catch (error) {
    console.error('Error getting drive structure for ' + userEmail + ': ' + error.toString());
    var errorData = {};
    errorData.drives = [];
    errorData.error = error.message;
    return errorData;
  }
}

/**
 * Gets drives accessible by the user
 */
function getUserDrives(userEmail) {
  var drives = [];
  
  try {
    var myDrive = {};
    myDrive.id = 'root';
    myDrive.name = userEmail + ' - My Drive';
    myDrive.type = 'my_drive';
    drives.push(myDrive);
    
    if (typeof Drive === 'undefined') {
      console.log('Drive API not available, only returning My Drive');
      return drives;
    }
    
    try {
      var requestOptions = {};
      requestOptions.useDomainAdminAccess = true;
      var sharedDrives = Drive.Drives.list(requestOptions);
      
      if (sharedDrives.drives) {
        for (var i = 0; i < sharedDrives.drives.length; i++) {
          var sharedDrive = sharedDrives.drives[i];
          var driveObj = {};
          driveObj.id = sharedDrive.id;
          driveObj.name = sharedDrive.name;
          driveObj.type = 'shared_drive';
          drives.push(driveObj);
        }
      }
    } catch (sharedDriveError) {
      console.log('Unable to access shared drives: ' + sharedDriveError.message);
    }
    
  } catch (error) {
    console.error('Error getting user drives: ' + error.toString());
  }
  
  return drives;
}

/**
 * Gets items in a specific drive or folder
 */
function getDriveItems(driveId, userEmail, folderId) {
  var items = {};
  items.folders = [];
  items.files = [];
  
  try {
    if (typeof Drive === 'undefined') {
      console.error('Drive API not available');
      return items;
    }
    
    var query = '';
    if (folderId) {
      query = "'" + folderId + "' in parents";
    } else if (driveId && driveId !== 'root') {
      query = "'" + driveId + "' in parents";
    } else {
      query = 'trashed = false';
    }
    
    if (query && query.indexOf('trashed') === -1) {
      query = query + ' and trashed = false';
    }
    
    var requestParams = {};
    requestParams.q = query;
    requestParams.fields = 'files(id,name,mimeType,owners,parents)';
    requestParams.maxResults = CONFIG.MAX_ITEMS_PER_FOLDER;
    requestParams.supportsAllDrives = true;
    requestParams.includeItemsFromAllDrives = true;
    
    var response;
    try {
      requestParams.useDomainAdminAccess = true;
      response = Drive.Files.list(requestParams);
    } catch (adminError) {
      console.log('Domain admin access failed, trying without: ' + adminError.message);
      delete requestParams.useDomainAdminAccess;
      response = Drive.Files.list(requestParams);
    }
    
    if (response.files) {
      for (var i = 0; i < response.files.length; i++) {
        var file = response.files[i];
        var itemInfo = {};
        itemInfo.id = file.id;
        itemInfo.name = file.name;
        itemInfo.owner = file.owners && file.owners[0] ? file.owners[0].emailAddress : 'Unknown';
        
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          items.folders.push(itemInfo);
        } else {
          items.files.push(itemInfo);
        }
      }
    }
    
  } catch (error) {
    console.error('Error getting drive items: ' + error.toString());
  }
  
  return items;
}

/**
 * Gets files in a specific folder
 */
function getFolderFiles(folderId, userEmail) {
  var items = getDriveItems(null, userEmail, folderId);
  return items.files;
}

/**
 * Executes the specified action on a drive item
 */
function executeAction(actionData) {
  try {
    validateActionData(actionData);
    
    var currentUser = Session.getActiveUser().getEmail();
    var result = {};
    
    if (actionData.action === 'transfer_ownership') {
      result = transferOwnership(actionData);
    } else if (actionData.action === 'move_file' || actionData.action === 'move_folder') {
      result = moveItem(actionData);
    } else if (actionData.action === 'rename_file' || actionData.action === 'rename_folder') {
      result = renameItem(actionData);
    } else {
      throw new Error('Unsupported action: ' + actionData.action);
    }
    
    var logData = {};
    logData.action = actionData.action;
    logData.itemType = actionData.itemType;
    logData.itemName = actionData.itemName;
    logData.itemId = actionData.itemId;
    logData.originalOwner = actionData.originalOwner;
    logData.newOwner = actionData.newOwner;
    logData.userEmail = actionData.userEmail;
    logData.performedBy = currentUser;
    logData.timestamp = new Date();
    logData.result = result.success ? 'Success' : 'Failed';
    logData.details = result.message;
    
    logAction(logData);
    
    var returnObj = {};
    returnObj.success = true;
    returnObj.message = result.message || 'Action completed successfully';
    return returnObj;
    
  } catch (error) {
    console.error('Error executing action: ' + error.toString());
    
    var failedLogData = {};
    failedLogData.action = actionData.action;
    failedLogData.itemType = actionData.itemType;
    failedLogData.itemName = actionData.itemName;
    failedLogData.itemId = actionData.itemId;
    failedLogData.originalOwner = actionData.originalOwner;
    failedLogData.newOwner = actionData.newOwner;
    failedLogData.userEmail = actionData.userEmail;
    failedLogData.performedBy = Session.getActiveUser().getEmail();
    failedLogData.timestamp = new Date();
    failedLogData.result = 'Failed';
    failedLogData.details = error.message;
    
    logAction(failedLogData);
    
    throw new Error(error.message);
  }
}

/**
 * Transfers ownership of a drive item
 */
function transferOwnership(actionData) {
  try {
    var permission = {};
    permission.role = 'owner';
    permission.type = 'user';
    permission.emailAddress = actionData.newOwner;
    
    var requestParams = {};
    requestParams.transferOwnership = true;
    requestParams.supportsAllDrives = true;
    
    try {
      requestParams.useDomainAdminAccess = true;
      Drive.Permissions.create(permission, actionData.itemId, requestParams);
    } catch (adminError) {
      console.log('Domain admin transfer failed, trying regular transfer: ' + adminError.message);
      delete requestParams.useDomainAdminAccess;
      Drive.Permissions.create(permission, actionData.itemId, requestParams);
    }
    
    var result = {};
    result.success = true;
    result.message = 'Ownership of "' + actionData.itemName + '" transferred to ' + actionData.newOwner;
    return result;
    
  } catch (error) {
    console.error('Error transferring ownership: ' + error.toString());
    throw new Error('Failed to transfer ownership: ' + error.message);
  }
}

/**
 * Moves a drive item to a new location
 */
function moveItem(actionData) {
  try {
    var requestParams = {};
    requestParams.fields = 'parents';
    requestParams.supportsAllDrives = true;
    
    var file;
    try {
      requestParams.useDomainAdminAccess = true;
      file = Drive.Files.get(actionData.itemId, requestParams);
    } catch (adminError) {
      delete requestParams.useDomainAdminAccess;
      file = Drive.Files.get(actionData.itemId, requestParams);
    }
    
    var previousParents = file.parents ? file.parents.join(',') : '';
    
    var updateParams = {};
    updateParams.addParents = actionData.newLocation;
    updateParams.removeParents = previousParents;
    updateParams.supportsAllDrives = true;
    
    try {
      updateParams.useDomainAdminAccess = true;
      Drive.Files.update({}, actionData.itemId, updateParams);
    } catch (adminError) {
      delete updateParams.useDomainAdminAccess;
      Drive.Files.update({}, actionData.itemId, updateParams);
    }
    
    var result = {};
    result.success = true;
    result.message = '"' + actionData.itemName + '" moved to new location successfully';
    return result;
    
  } catch (error) {
    console.error('Error moving item: ' + error.toString());
    throw new Error('Failed to move item: ' + error.message);
  }
}

/**
 * Renames a drive item
 */
function renameItem(actionData) {
  try {
    var updateParams = {};
    updateParams.supportsAllDrives = true;
    
    var fileUpdate = {};
    fileUpdate.name = actionData.newName;
    
    try {
      updateParams.useDomainAdminAccess = true;
      Drive.Files.update(fileUpdate, actionData.itemId, updateParams);
    } catch (adminError) {
      delete updateParams.useDomainAdminAccess;
      Drive.Files.update(fileUpdate, actionData.itemId, updateParams);
    }
    
    var result = {};
    result.success = true;
    result.message = '"' + actionData.itemName + '" renamed to "' + actionData.newName + '" successfully';
    return result;
    
  } catch (error) {
    console.error('Error renaming item: ' + error.toString());
    throw new Error('Failed to rename item: ' + error.message);
  }
}

/**
 * Logs action to Google Sheet
 */
function logAction(logData) {
  try {
    var sheet = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
    var logSheet;
    
    try {
      logSheet = sheet.getSheetByName(CONFIG.LOG_SHEET_NAME);
    } catch (error) {
      logSheet = sheet.insertSheet(CONFIG.LOG_SHEET_NAME);
      
      var headers = [
        'Timestamp',
        'Action',
        'Item Type',
        'Item Name',
        'Item ID',
        'Original Owner',
        'New Owner',
        'User Email',
        'Performed By',
        'Result',
        'Details'
      ];
      
      logSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      logSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
    
    var rowData = [
      logData.timestamp,
      logData.action,
      logData.itemType,
      logData.itemName,
      logData.itemId,
      logData.originalOwner || '',
      logData.newOwner || '',
      logData.userEmail,
      logData.performedBy,
      logData.result,
      logData.details || ''
    ];
    
    logSheet.appendRow(rowData);
    console.log('Action logged successfully');
    
  } catch (error) {
    console.error('Error logging action: ' + error.toString());
  }
}

/**
 * Validates action data before processing
 */
function validateActionData(actionData) {
  if (!actionData) {
    throw new Error('Action data is required');
  }
  
  var requiredFields = ['action', 'itemId', 'itemType', 'itemName', 'userEmail'];
  
  for (var i = 0; i < requiredFields.length; i++) {
    var field = requiredFields[i];
    if (!actionData[field]) {
      throw new Error('Missing required field: ' + field);
    }
  }
  
  if (!isValidEmail(actionData.userEmail)) {
    throw new Error('Invalid user email address');
  }
  
  if (actionData.newOwner && !isValidEmail(actionData.newOwner)) {
    throw new Error('Invalid new owner email address');
  }
  
  var validActions = [
    'transfer_ownership',
    'move_file',
    'move_folder',
    'rename_file',
    'rename_folder'
  ];
  
  var isValidAction = false;
  for (var i = 0; i < validActions.length; i++) {
    if (validActions[i] === actionData.action) {
      isValidAction = true;
      break;
    }
  }
  
  if (!isValidAction) {
    throw new Error('Invalid action type: ' + actionData.action);
  }
}

/**
 * Validates email address format
 */
function isValidEmail(email) {
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Checks if current user has admin permissions
 */
function checkAdminPermissions() {
  var currentUser = Session.getActiveUser().getEmail();
  
  var hasPermission = false;
  for (var i = 0; i < CONFIG.ADMIN_EMAILS.length; i++) {
    if (CONFIG.ADMIN_EMAILS[i] === currentUser) {
      hasPermission = true;
      break;
    }
  }
  
  if (!hasPermission) {
    throw new Error('Insufficient permissions. Admin access required.');
  }
  
  return true;
}

/**
 * Gets available folders for move operations
 */
function getAvailableFolders(userEmail) {
  try {
    var folders = [];
    var drives = getUserDrives(userEmail);
    
    for (var i = 0; i < drives.length; i++) {
      var drive = drives[i];
      var items = getDriveItems(drive.id, userEmail);
      
      var driveFolder = {};
      driveFolder.id = drive.id;
      driveFolder.name = drive.name;
      driveFolder.path = drive.name;
      folders.push(driveFolder);
      
      for (var j = 0; j < items.folders.length; j++) {
        var folder = items.folders[j];
        var folderObj = {};
        folderObj.id = folder.id;
        folderObj.name = folder.name;
        folderObj.path = drive.name + '/' + folder.name;
        folders.push(folderObj);
      }
    }
    
    return folders;
    
  } catch (error) {
    console.error('Error getting available folders: ' + error.toString());
    return [];
  }
}

/**
 * Test function to verify setup
 */
function testSetup() {
  try {
    console.log('=== Testing OppCO Drive Management setup ===');
    console.log('Time: ' + new Date());
    
    console.log('--- Configuration Check ---');
    console.log('Domain: ' + CONFIG.DOMAIN);
    console.log('Log Sheet ID: ' + CONFIG.LOG_SHEET_ID);
    console.log('Admin Emails: ' + CONFIG.ADMIN_EMAILS.join(', '));
    
    console.log('--- Current User Check ---');
    var currentUser = Session.getActiveUser().getEmail();
    console.log('Current user: ' + currentUser);
    var userDomain = currentUser.split('@')[1];
    console.log('User domain: ' + userDomain);
    
    if (userDomain !== CONFIG.DOMAIN) {
      console.log('WARNING: User domain (' + userDomain + ') does not match config domain (' + CONFIG.DOMAIN + ')');
    }
    
    console.log('--- API Availability Check ---');
    console.log('AdminDirectory available: ' + (typeof AdminDirectory !== 'undefined'));
    console.log('Drive API available: ' + (typeof Drive !== 'undefined'));
    
    console.log('--- Admin SDK Access Test ---');
    if (typeof AdminDirectory !== 'undefined') {
      try {
        var testUsers = getAllWorkspaceUsers();
        console.log('Admin SDK working - Found ' + testUsers.length + ' users');
        
        if (testUsers.length > 0) {
          console.log('--- Drive API Access Test ---');
          var testStructure = getUserDriveStructure(testUsers[0].primaryEmail);
          console.log('Drive structure test: ' + (testStructure.error ? 'Failed - ' + testStructure.error : 'Success'));
        }
      } catch (error) {
        console.log('Admin SDK failed: ' + error.message);
      }
    } else {
      console.log('Admin SDK not available - please enable it in Services');
    }
    
    console.log('--- Sheet Access Test ---');
    try {
      var sheet = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
      console.log('Sheet access successful: ' + sheet.getName());
    } catch (error) {
      console.log('Sheet access failed: ' + error.message);
    }
    
    console.log('=== Setup test completed ===');
    return true;
    
  } catch (error) {
    console.error('Setup test failed: ' + error.toString());
    return false;
  }
}

/**
 * Simple test for Admin SDK only
 */
function testAdminSDKOnly() {
  try {
    console.log('Testing Admin SDK only...');
    console.log('Current user: ' + Session.getActiveUser().getEmail());
    console.log('Domain: ' + CONFIG.DOMAIN);
    
    if (typeof AdminDirectory === 'undefined') {
      console.log('AdminDirectory not available - add Admin SDK API in Services');
      return false;
    }
    
    var requestOptions = {};
    requestOptions.domain = CONFIG.DOMAIN;
    requestOptions.maxResults = 1;
    
    var response = AdminDirectory.Users.list(requestOptions);
    
    console.log('Admin SDK working!');
    console.log('Response: ' + JSON.stringify(response));
    return true;
    
  } catch (error) {
    console.error('Admin SDK error: ' + error.toString());
    return false;
  }
}

/**
 * Creates log sheet with proper headers
 */
function createLogSheet() {
  try {
    var sheet = SpreadsheetApp.openById(CONFIG.LOG_SHEET_ID);
    var logSheet;
    
    try {
      logSheet = sheet.getSheetByName(CONFIG.LOG_SHEET_NAME);
      console.log('Log sheet already exists');
      return;
    } catch (error) {
      // Sheet does not exist, create it
    }
    
    logSheet = sheet.insertSheet(CONFIG.LOG_SHEET_NAME);
    
    var headers = [
      'Timestamp',
      'Action',
      'Item Type',
      'Item Name',
      'Item ID',
      'Original Owner',
      'New Owner',
      'User Email',
      'Performed By',
      'Result',
      'Details'
    ];
    
    var headerRange = logSheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('#ffffff');
    
    logSheet.setColumnWidth(1, 150);
    logSheet.setColumnWidth(2, 120);
    logSheet.setColumnWidth(3, 80);
    logSheet.setColumnWidth(4, 200);
    logSheet.setColumnWidth(5, 150);
    logSheet.setColumnWidth(6, 150);
    logSheet.setColumnWidth(7, 150);
    logSheet.setColumnWidth(8, 150);
    logSheet.setColumnWidth(9, 150);
    logSheet.setColumnWidth(10, 80);
    logSheet.setColumnWidth(11, 200);
    
    console.log('Log sheet created successfully');
    
  } catch (error) {
    console.error('Error creating log sheet: ' + error.toString());
    throw error;
  }
}
