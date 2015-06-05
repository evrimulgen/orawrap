/* Copyright (c) 2015, Oracle and/or its affiliates. All rights reserved. */

/******************************************************************************
 *
 * You may not use the identified files except in compliance with the Apache
 * License, Version 2.0 (the "License.")
 *
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * NAME
 *   database.js
 *
 * DESCRIPTION
 *   A wrapper module for node-oracledb.
 *
 *****************************************************************************/

var oracledb = require('oracledb');
var Promise = require('es6-promise').Promise;
var async = require('async');
var pool;
var buildupScripts = [];
var teardownScripts = [];
var connectInfo;

//Query result outFormat option constants
module.exports.ARRAY = oracledb.ARRAY;
module.exports.OBJECT = oracledb.OBJECT;

//Constants for bind parameter type properties
module.exports.STRING = oracledb.STRING;
module.exports.NUMBER = oracledb.NUMBER;
module.exports.DATE = oracledb.DATE;

//Constants for bind parameter dir properties
module.exports.BIND_IN = oracledb.BIND_IN;
module.exports.BIND_OUT = oracledb.BIND_OUT;
module.exports.BIND_INOUT = oracledb.BIND_INOUT;

function setConnectInfo(ci) {
    connectInfo = {
        user: ci.user,
        password: ci.password,
        connectString: ci.connectString,
        externalAuth: ci.externalAuth
    };
}

module.exports.setConnectInfo = setConnectInfo;

function createPool(config, cb) {
    return new Promise(function(resolve, reject) {
        oracledb.createPool(
            config,
            function(err, p) {
                if (err) {
                    reject(err);

                    if (cb) {
                        cb(err);
                    }

                    return;
                }

                pool = p;

                resolve(pool);
                
                if (cb) {
                    cb(null, pool);
                }
            }
        );
    });
}

module.exports.createPool = createPool;

function terminatePool(cb) {
    return new Promise(function(resolve, reject) {
        if (pool) {
            pool.terminate(function(err) {
                if (err) {
                    reject(err);

                    if (cb) {
                        cb(err);
                    }

                    return;
                }

                resolve();

                if (cb) {
                    cb(null);
                }
            });
        } else {
            resolve();

            if (cb) {
                cb(null);
            }
        }
    });
}

module.exports.terminatePool = terminatePool;

function getPool() {
    return pool;
}

module.exports.getPool = getPool;

function addBuildupSql(statement) {
    var stmt = {
        sql: statement.sql,
        binds: statement.binds || {},
        options: statement.options || {}
    };

    buildupScripts.push(stmt);
}

module.exports.addBuildupSql = addBuildupSql;

function addTeardownSql(statement) {
    var stmt = {
        sql: statement.sql,
        binds: statement.binds || {},
        options: statement.options || {}
    };

    teardownScripts.push(stmt);
}

module.exports.addTeardownSql = addTeardownSql;

function getConnection(cb) {
    return new Promise(function(resolve, reject) {
        var getConnCb = function(err, connection) {
            if (err) {
                reject(err);

                if (cb) {
                    cb(err);
                }

                return;
            }

            async.eachSeries(
                buildupScripts,
                function(statement, callback) {
                    connection.execute(statement.sql, statement.binds, statement.options, function(err) {
                        callback(err);
                    });
                },
                function(err) {
                    if (err) {
                        reject(err);

                        if (cb) {
                            cb(err);
                        }

                        return;
                    }

                    resolve(connection);

                    if (cb) {
                        cb(null, connection);
                    }
                }
            );
        };

        if (pool) {
            pool.getConnection(getConnCb);
        } else {
            oracledb.getConnection(connectInfo, getConnCb);
        }
    });
}

module.exports.getConnection = getConnection;

function execute(sql, bindParams, options, connection, cb) {
    return new Promise(function(resolve, reject) {
        connection.execute(sql, bindParams, options, function(err, results) {
            if (err) {
                reject(err);

                if (cb) {
                    cb(err);
                }

                return;
            }

            resolve(results);

            if (cb) {
                cb(null, results);
            }
        });
    });
}

module.exports.execute = execute;

function releaseConnection(connection) {
    async.eachSeries(
        teardownScripts,
        function(statement, callback) {
            connection.execute(statement.sql, statement.binds, statement.options, function(err) {
                callback(err);
            });
        },
        function(err) {
            if (err) {
                console.error(err); //don't return as we still need to release the connection
            }

            connection.release(function(err) {
                if (err) {
                    console.error(err);
                }
            });
        }
    );
}

module.exports.releaseConnection = releaseConnection;

function simpleExecute(sql, bindParams, options, cb) {
    if (options.autoCommit === undefined) {//isAutoCommit was renamed to autoCommit in node-oracledb v0.5.0
        options.autoCommit = true;
    }

    if (options.isAutoCommit === undefined) {//isAutoCommit was left for backward compatibility, should probably remove in future
        options.isAutoCommit = true;
    }

    return new Promise(function(resolve, reject) {
        getConnection()
            .then(function(connection) {
                execute(sql, bindParams, options, connection)
                    .then(function(results) {
                        resolve(results);

                        if (cb) {
                            cb(null, results);
                        }

                        process.nextTick(function() {
                            releaseConnection(connection);
                        });
                    })
                    .catch(function(err) {
                        reject(err);

                        if (cb) {
                            cb(err);
                        }

                        process.nextTick(function() {
                            releaseConnection(connection);
                        });
                    });
            })
            .catch(function(err) {
                reject(err);

                if (cb) {
                    cb(err);
                }
            });
    });
}

module.exports.simpleExecute = simpleExecute;
