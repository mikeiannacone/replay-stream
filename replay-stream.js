/*jshint node:true, indent:2, globalstrict: true, asi: true, laxcomma: true, laxbreak: true */
/*global module:true, require:true, console:true, process:true */

/**
 *
 * This module will transform a string into stringified JSON object
 * It will input a stream, parse it according to a regular expression and output to a stream.
 *
 * # Example:
 *    var ReplayStream = require('replay-stream')
 *    var replayStream = new ReplayStream(parserConfig)
 *    util.pump(inputStream, replayStream)
 *    util.pump(replayStream, outputStream)
 *
 */

'use strict';

module.exports = ReplayStream

var Stream = require('stream').Stream
  , util = require('util')
  , moment = require('moment')


//TODO input/output as either moment or as epoc time
/**
 *
 * Constructor is a single global object
 *
 * @param {Object} replayConfig The regular expression configuration. Available options: 
 *  replayConfig.relativeTime        //if true, will output the results in 'relative time', meaning with a delay of the entry's timestamp minus the startTime argument below.
 *  replayConfig.startTime           //will ignore entries before this time.  specified in seconds, unix-style
 *  replayConfig.endTime             //will ignore entries after this time.  specified in seconds, unix-style
 *  replayConfig.timestampName     //the name of the field that contains the timestamp.  Default is "timestamp"
 *  replayConfig.timestampType     //the type of timestamp, currently only "moment" is defined.
 *  replayConfig.stringifyOutput     //will make sure that output is stringified if needed.
 *
 */
function ReplayStream(replayConfig) {
  
  // name of the application, defined in package.json, used for errors
  this._appName = require('./package').name
  this._version = require('./package').version
  this._errorPrefix = this._appName + ': '

  this.writable = true
  this.readable = true

  this._relativeTime = false
  if (replayConfig && replayConfig.relativeTime && replayConfig.relativeTime === true)
    this._relativeTime = true

  this._hasTimestamp = false
  if (replayConfig && replayConfig.timestampName)
    this._hasTimestamp = true
  //TODO if false, emit some warning/error

  this.startTime = 0
  if (replayConfig && replayConfig.startTime) 
    this.startTime = replayConfig.startTime

  this.endTime = Number.MAX_VALUE 
  if (replayConfig && replayConfig.endTime) 
    this.endTime = replayConfig.endTime

  this._paused = this._ended = this._destroyed = false
  
  // set up static errors
  this._errorBadConfig = new Error(this._errorPrefix + 'replay stream configuration incorrect.')
  this._errorWriteAfterEnd = new Error(this._errorPrefix + 'attempt to write to a stream that has ended.')
  this._errorUnwritable = new Error(this._errorPrefix + 'attempt to write to a stream that is not writable.')
  
  
  // set up options 
  //TODO sanity check these options, use defaults, etc.
  if (typeof replayConfig !== 'undefined') {
    this._relativeTime = replayConfig.relativeTime
    this._startTime = replayConfig.startTime
    this._endTime = replayConfig.endTime
    this._timestampName = replayConfig.timestampName
    this._timestampType = replayConfig.timestampType
    this._stringifyOutput = replayConfig.stringifyOutput
  }

  Stream.call(this)
  
  return this
}

// inherit from [Stream](http://nodejs.org/docs/latest/api/stream.html)
util.inherits(ReplayStream, Stream)


/**
 *
 * Parse a chunk and emit the parsed data
 * 
 * @param {String} data to write to stream (assumes UTF-8)
 * @returns {boolean} true if written, false if it will be sent later
 * @see http://nodejs.org/docs/latest/api/stream.html#stream_stream_write_string_encoding
 *
 */
ReplayStream.prototype.write = function (data) {
  console.log('trying to write data of ' + data)

  // cannot write to a stream after it has ended
  if (this._ended)
    throw this._errorWriteAfterEnd

  // stream must be writable in order to write to it
  if (! this.writable) 
    throw this._errorUnwritable
  
  // stream must not be paused
  if (this._paused) 
    return false
  
  var self = this
  var emitDelayed = function (msg) {
    var delay = msg.timestamp - (self.startTime * 1000)
    //console.log('delay of ' + delay)
    setTimeout(function () {
        if (! self._ended) {
          //console.log('emitting')
          if(this._stringifyOutput && typeof msg !== "string"){
            result = JSON.stringify(msg)
          }
          console.log('b: result is ' + result)
          self.emit('data', msg)
        }
        else {
          console.log('not emitting, ended already')
        }
      }, delay)
  }

  try {
    var result = data //TODO probably more general way to handle this
    if( typeof data === "string"){
      result = JSON.parse(data)
    }
    //console.log( 'got a result of: ' + JSON.stringify(result))
    if (! this._hasTimestamp) { //TODO probably will always have timestamp, not sure this is even useful to handle.
      if(this._stringifyOutput && typeof result !== "string"){
        result = JSON.stringify(result)
      }
      console.log('c: result is ' + result)
      this.emit('data', result)
    }
    else {
      if (true || (this._startTime < (this.parseMoment(result.timestamp) / 1000) && (this.parseMoment(result.timestamp) / 1000) < this._endTime) ){
        if (this._relativeTime) {
          emitDelayed(result)
        }
        else {
          if(this._stringifyOutput && typeof result !== "string"){
            result = JSON.stringify(result)
          }
          console.log('a: result is ' + result)
          process.nextTick(function () {
            self.emit('data', result)
          })
        }
      }
    }
  }
  catch (err) {
    console.log('some error emitted for some reason: ' + err)
    var error = new Error('ReplayStream: parsing error - ' + err)
    this.emit('error', error)
  }
  
  return true   
}

/*
 *
 * Write optional parameter and terminate the stream, allowing queued write data to be sent before closing the stream.
 *
 * @param {String} data The data to write to stream (assumes UTF-8)
 * @see http://nodejs.org/docs/latest/api/stream.html#stream_stream_end
 *
 */
ReplayStream.prototype.end = function (str) {
  if (this._ended) return
  
  if (! this.writable) return

  if (arguments.length) {
    this.write(str)
  }
  
  this._ended = true
  this.readable = false
  this.writable = false

  this.emit('end')
  this.emit('close')
}

/*
 *
 * Pause the stream
 *
 * @see http://nodejs.org/docs/latest/api/stream.html#stream_stream_pause
 *
 */
ReplayStream.prototype.pause = function () {
  if (this._paused) return
  
  this._paused = true
  this.emit('pause')
}

/*
 *
 * Resume stream after a pause, emitting a drain
 *
 */
ReplayStream.prototype.resume = function () {
  if (this._paused) {
    this._paused = false
    this.emit('drain')
  }
}

/*
 *
 * Destroy the stream. Stream is no longer writable nor readable.
 *
 */
ReplayStream.prototype.destroy = function () {
  if (this._destroyed) return
  
  this._destroyed = true
  this._ended = true

  this.readable = false
  this.writable = false

  this.emit('end')
  this.emit('close')
}

/*
 *
 * Uses [Moment.js](http://momentjs.com/) to parse a string into a timestamp
 * If data cannot be properly parsed, an error is emitted
 * 
 * @param {String} string The string to parse
 * @param {String} formatter The formatter to use to parse
 * @return {Number} timestamp The number of *milliseconds* since the Unix Epoch
 * @api private
 *
 */
ReplayStream.prototype.parseMoment = function (string, formatter) {

  // set to UTC by adding '+0000' to input string and 'ZZ' to format string
  if (! formatter.match(/\+Z+/)) {
    string = string + '+0000'
    formatter = formatter + 'ZZ'
  }

  try {
    // parse using the formatter for moment
    var timestamp = moment(string, formatter)

    // if there is no year in the timestamp regex set it to this year
    if (! formatter.match(/YY/))
      timestamp.year(moment().year())

    return timestamp.valueOf()
    
  }
  catch (err) {
    this.emit('error', new Error(this._errorPrefix + 'Timestamp parsing error. ' + err))
  }

  return false
}
