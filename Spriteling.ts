import find from 'array-find'
import 'es6-promise/auto'

import imageLoaded from 'image-loaded'
import raf from 'raf'
import { Animation, AnimationOptions, Frame, SpriteSheet, SpriteSheetOptions } from './types'

const playheadDefaults: Animation = {
  play: true,
  delay: 50,
  tempo: 1,
  run: -1,
  reversed: false,
  script: [],
  lastTime: 0,
  nextDelay: 0,
  currentSprite: 1,
  currentFrame: -1,
  onPlay: null,
  onStop: null,
  onFrame: null,
  onOutOfView: null
}

class Spriteling {
  private spriteSheet: SpriteSheet = {
    meta: null,
    loaded: false,
    url: null,
    imageUrl: null,
    cutOffFrames: 0,
    top: null,
    bottom: null,
    left: null,
    right: null,
    startSprite: 1,
    downsizeRatio: 1,
    fillCanvas: true,
    sheetWidth: 0,
    sheetHeight: 0,
    frames: [],
    animations: {},
    onLoaded: null
  }

  private context: CanvasRenderingContext2D

  private playhead: Animation

  private readonly element: HTMLElement
  private readonly canvas: HTMLCanvasElement

  private debug: boolean

  private loadingPromise: Promise<void>

  private image: any

  private createdCanvas: boolean = false

  /**
   * Creates a new Spriteling instance. The options object can contain the following values
   * - url: url to spriteSheet, if not set the css background-image will be used
   * - cols: number columns in the spritesheet (mandatory)
   * - rows: number rows in the spritesheet (mandatory)
   * - cutOffFrames: number of sprites not used in the spritesheet (default: 0)
   * - top/bottom/left/right: starting offset position of placeholder element
   * - startSprite: number of the first sprite to show when done loading
   * - onLoaded: callback that will be called when loading has finished
   *
   * Element can be a css selector or existing DOM element or null, in which case a new div element will be created
   *
   * Debug adds logging in console, useful when working on the animation
   *
   * @param {object} options
   * @param {HTMLElement | string} element
   * @param {boolean} debug
   */
  constructor(
    options: SpriteSheetOptions,
    element?: HTMLElement | string,
    debug: boolean = false
  ) {
    // Lookup element by selector
    if (element) {
      this.element = typeof element === 'string' ? document.querySelector(element) as HTMLElement : element
      if (this.element instanceof HTMLCanvasElement) {
        this.canvas = this.element

        // Add spriteling class
        this.element.className += ' spriteling'
      } else {
        const canvas = document.createElement('canvas')
        const rect = this.element.getBoundingClientRect()
        canvas.className = 'spriteling'
        canvas.width = rect.width
        canvas.height = rect.height
        canvas.style.width = rect.width + 'px'
        canvas.style.height = rect.height + 'px'
        this.element.appendChild(canvas)
        this.canvas = canvas
        this.createdCanvas = true
      }
      this.context = (this.canvas as HTMLCanvasElement).getContext('2d')

    } else {
      if (typeof this.element !== 'undefined') {
        this.log('warn', `element "${element}" not found`)
        return
      }
    }

    // Combine options with defaults
    this.spriteSheet = { ...this.spriteSheet, ...options }
    this.playhead = { ...playheadDefaults }
    this.debug = debug || false

    // Create loading promise
    this.loadingPromise = this.loadSpriteSheet().then(() => {
      this.spriteSheet.loaded = true
      // If starting sprite is set, show it
      if (this.spriteSheet.startSprite > 1 && this.spriteSheet.startSprite <= this.spriteSheet.frames.length) {
        this.drawFrame({ index: this.spriteSheet.startSprite })
      }

      // onLoaded callback
      if (typeof this.spriteSheet.onLoaded === 'function') {
        this.spriteSheet.onLoaded()
      }
    })
  }

  /**
   * Stop the current animation and show the specified sprite
   * @param {number} spriteNumber
   */
  public async showSprite(
    spriteNumber: number
  ): Promise<void> {
    await this.loadingPromise

    this.playhead.play = false

    this.drawFrame({ index: spriteNumber })
  }

  /**
   * Get the current spriteNumber that is shown
   * @returns {number}
   */
  public currentSprite(): number {
    return this.playhead.currentSprite
  }

  /**
   * Add a named animation sequence
   *
   * Name can be any string value
   *
   * Script should be an array of frame objects, each can have the following properties
   * - sprite: which sprite to show (mandatory)
   * - delay: alternate delay then the default delay
   * - top/left/bottom/right: reposition the placeholder element
   *
   * @param {string} name
   * @param {Frame[]} script
   */
  public addScript(name: string, script: Frame[]) {
    const actions = []
    for (const act of script) {
      const frame = {
        ...find(this.spriteSheet.frames, (item) => {
          return act.index === item.index || act.name === item.name
        }), ...act
      }
      this.log('info', frame)
      actions.push(frame)
    }
    this.spriteSheet.animations[name] = actions
  }

  /**
   * Resume/play current or given animation.
   * Method can be called in four ways:
   *
   * .play() - resume current animation sequence (if not set - loops over all sprites once)
   * .play(scriptName) - play given animation script
   * .play(scriptName, { options }) - play given animation script with given options
   * .play({ options }) - play current animation with given options
   *
   * ScriptName loads a previously added animation with .addScript()
   *
   * Options object can contain
   * - play: start playing the animation right away (default: true)
   * - run: the number of times the animation should run, -1 is infinite (default: 1)
   * - delay: default delay for all frames that don't have a delay set (default: 50)
   * - tempo: timescale for all delays, double-speed = 2, half-speed = .5 (default:1)
   * - reversed: direction of the animation head, true == backwards (default: false)
   * - script: New unnamed animation sequence, array of frames, see .addScript (default: null)
   * - onPlay/onStop/onFrame/onOutOfView: callbacks called at the appropriate times (default: null)
   *
   * @param {string | Animation} scriptName
   * @param {Animation} options
   * @returns {boolean}
   */
  public async play(
    scriptName?: string | AnimationOptions,
    options?: AnimationOptions
  ): Promise<void> {
    await this.loadingPromise

    // play()
    if (!scriptName && !options) {

      // Play if not already playing
      if (!this.playhead.play) {
        if (this.playhead.run === 0) {
          this.playhead.run = 1
        }
        this.playhead.play = true
      }

    } else {
      let animationScript: Frame[]
      let animationOptions: AnimationOptions = {}

      // play('someAnimation')
      if (typeof scriptName === 'string' && !options) {
        if (this.spriteSheet.animations[scriptName]) {
          this.log('info', `playing animation "${scriptName}"`)
          animationScript = this.spriteSheet.animations[scriptName]
        } else {
          this.log('warn', `animation "${scriptName}" not found`)
        }

        // play('someAnimation', { options })
      } else if (typeof scriptName === 'string' && typeof options === 'object') {
        animationScript = this.spriteSheet.animations[scriptName]
        animationOptions = options

        // play({ options })
      } else if (typeof scriptName === 'object' && !options) {
        animationScript = scriptName.script || this.playhead.script
        animationOptions = scriptName
      }

      // Fallback to default script
      if (!animationScript) {
        if (this.spriteSheet.animations.default) {
          this.log('info', `playing animation default`)
          animationScript = this.spriteSheet.animations.default
        } else {
          this.playhead.run = 0
          this.playhead.play = false
          return
        }
      }

      // Set starting frame
      let currentFrame = -1
      if (animationOptions.reversed) {
        currentFrame = animationScript.length
      }

      this.playhead = {
        ...playheadDefaults,
        ...{ script: animationScript },
        ...animationOptions,
        ...{ currentFrame }
      }
    }

    // Enter the animation loop
    if (this.playhead.run !== 0 && this.playhead.play) {
      this.loop()
    }

    // onPlay callback
    if (typeof this.playhead.onPlay === 'function') {
      this.playhead.onPlay()
    }
  }

  public isPlaying(): boolean {
    return this.playhead.play
  }

  /**
   * Set playback tempo, double-speed = 2, half-speed = .5 (default:1)
   * @param {number} tempo
   */
  public async setTempo(
    tempo: number
  ): Promise<void> {
    await this.loadingPromise

    this.playhead.tempo = tempo
  }

  /**
   * Get playback tempo, double-speed = 2, half-speed = .5 (default:1)
   * @returns {number}
   */
  public getTempo(): number {
    return this.playhead.tempo
  }

  /**
   * Step the animation ahead one frame
   * @returns {boolean}
   */
  public async next(): Promise<void> {
    await this.loadingPromise

    // Update frame counter
    this.playhead.currentFrame += 1

    // End of script?
    if (this.playhead.currentFrame === this.playhead.script.length) {
      this.playhead.run -= 1
      this.playhead.currentFrame = 0
    }

    // Stop when playing and run reached 0
    if (this.playhead.play && this.playhead.run === 0) {
      this.stop()
    } else {
      const frame = this.playhead.script[this.playhead.currentFrame]
      this.drawFrame(frame)
    }
  }

  /**
   * Step the animation backwards one frame
   * @returns {boolean}
   */
  public async previous(): Promise<void> {
    await this.loadingPromise

    // Update frame counter
    this.playhead.currentFrame -= 1

    // End of script?
    if (this.playhead.currentFrame < 0) {
      this.playhead.currentFrame = this.playhead.script.length - 1
      this.playhead.run -= 1
    }

    if (this.playhead.play && this.playhead.run === 0) {
      this.stop()
    } else {
      const frame = this.playhead.script[this.playhead.currentFrame]
      this.drawFrame(frame)
    }
  }

  /**
   * Jump to certain frame within current animation sequence
   * @param frameNumber [integer]
   * @returns {boolean}
   */
  public async goTo(
    frameNumber: number
  ): Promise<void> {
    await this.loadingPromise

    // Make sure given frame is within the animation
    const baseNumber = Math.floor(frameNumber / this.playhead.script.length)
    frameNumber = Math.floor(frameNumber - (baseNumber * this.playhead.script.length))

    // Draw frame
    this.playhead.currentFrame = frameNumber
    const frame = this.playhead.script[this.playhead.currentFrame]
    if (frame) {
      this.log('info', `frame: ${this.playhead.currentFrame}, index: ${frame.index}`)
      this.drawFrame(frame)
    }
  }

  /**
   * Reverse direction of play
   */
  public async reverse(): Promise<void> {
    await this.loadingPromise

    this.playhead.reversed = !this.playhead.reversed
  }

  /**
   * Get the current direction of play
   * @returns {boolean}
   */
  public isReversed(): boolean {
    return this.playhead.reversed
  }

  /**
   * Stop the animation
   */
  public async stop(): Promise<void> {
    await this.loadingPromise

    this.playhead.play = false

    // onStop callback
    if (typeof this.playhead.onStop === 'function') {
      this.playhead.onStop()
    }
  }

  /**
   * Reset playhead to first frame
   */
  public async reset(): Promise<void> {
    await this.loadingPromise

    this.goTo(0)
  }

  /**
   * Removes the element and kills the animation loop
   */
  public destroy() {
    this.playhead.play = false
    if (this.createdCanvas) {
      const rect = this.canvas.getBoundingClientRect()
      this.context.clearRect(0, 0, rect.width, rect.height)
    } else {
      this.element.removeChild(this.canvas)
    }
  }

  /**
   * Load the spritesheet and position it correctly
   */
  private async loadSpriteSheet() {
    let json
    let meta
    const url = this.spriteSheet.url
    if (!this.spriteSheet.url) {
      this.log('error', `spritesheet url is not found`)
    } else {
      const res = await fetch(this.spriteSheet.url)
      json = await res.json()
      meta = json.meta
      this.log('info', `json loaded: ${this.spriteSheet.url}`, json)
    }
    // load image source
    const image = meta.image
    this.spriteSheet.meta = meta
    if (!this.spriteSheet.imageUrl && typeof image === 'string') {
      if ((image as string).indexOf('http') !== 0) {
        this.spriteSheet.imageUrl = url.substring(0, url.lastIndexOf('\/') + 1) + image
      }
    }
    this.image = await this.loadImage()
    const sheet = this.spriteSheet
    this.log('info', `image loaded: ${this.spriteSheet.imageUrl}`)
    this.spriteSheet.sheetWidth = meta.size.w
    this.spriteSheet.sheetHeight = meta.size.h
    this.spriteSheet.frames = []
    if (json.frames instanceof Array) {
      for (let i = 0; i < json.frames.length; i++) {
        const element = json.frames[i]
        this.spriteSheet.frames.push({
          name: element.filename,
          index: i,
          ...element
        })

      }
    } else {
      let i = 0
      for (const key in json.frames) {
        if (json.frames.hasOwnProperty(key)) {
          const element = json.frames[key]
          this.spriteSheet.frames.push({
            name: key,
            index: i++,
            ...element
          })

        }
      }
    }
    // Auto script the first 'all' animation sequence and make it default
    this.autoScript()
    const animationOptions = { script: sheet.animations.all }
    this.playhead = { ...playheadDefaults, ...animationOptions }
  }
  private loadImage() {

    return new Promise((resolve) => {
      const preload = new Image()
      preload.src = this.spriteSheet.imageUrl
      imageLoaded(preload, () => {
        resolve(preload)
      })
    })
  }
  private autoScript() {
    const animations = this.spriteSheet.animations
    for (const key in animations) {
      if (animations.hasOwnProperty(key)) {
        this.addScript(key, animations[key])
      }
    }
    this.addScript('all', this.spriteSheet.frames)
  }
  /**
   * The animation loop
   */
  private loop = (time: number = 0) => {
    const requestFrameId = raf(this.loop)
    const playhead = this.playhead

    // Wait until fully loaded
    if (!this.element || !this.spriteSheet.loaded) {
      return
    }

    // Throttle on nextDelay
    if ((time - playhead.lastTime) >= playhead.nextDelay) {
      this.render(time)
    }

    // Cancel animation loop if play = false
    if (!playhead.play) {
      raf.cancel(requestFrameId)
      return
    }
  }

  private async render(time: number) {
    const element = this.element
    const playhead = this.playhead

    // Render next frame only if element is visible and within viewport
    if (element.offsetParent !== null && this.inViewport()) {

      // Only play if run counter is still <> 0
      if (playhead.run !== 0) {

        if (playhead.reversed) {
          await this.previous()
        } else {
          await this.next()
        }

        const frame = playhead.script[playhead.currentFrame]
        this.log('info', `run: ${playhead.run}, frame`, frame)

        playhead.lastTime = time
      }

    } else {

      if (typeof playhead.onOutOfView === 'function') {
        playhead.onOutOfView()
      }

    }
  }
  /**
   * Fill to container
   * @param srcW source width
   * @param srcH source height
   * @param maxW max width
   * @param maxH max height
   * @returns [x,y,w,h]
   */
  private fillSize(srcW: number, srcH: number, maxW: number, maxH: number): [number, number, number, number, number] {

    let x
    let y
    let w
    let h
    let r

    if (maxW / srcW > maxH / srcH) {
      h = maxH
      r = maxH / srcH
      w = srcW * r
      x = (maxW - w) * 0.5
      y = 0
    } else {
      w = maxW
      r = maxW / srcW
      h = srcH * r
      x = 0
      y = (maxH - h) * 0.5
    }
    return [x, y, w, h, r]
  }
  /**
   * Draw a frame on canvas
   */
  private drawFrame(frame: Frame) {
    const sheet = this.spriteSheet
    const playhead = this.playhead
    const canvas = this.canvas
    this.log('info', 'frame', frame)
    this.playhead.nextDelay = frame.delay ? frame.delay : this.playhead.delay
    this.playhead.nextDelay /= this.playhead.tempo

    if (frame.index !== playhead.currentSprite) {

      // Set sprite
      playhead.currentSprite = frame.index
      // Animate
      this.context.clearRect(0, 0, canvas.width, canvas.height)
      let x = 0
      let y = 0
      let width = frame.sourceSize.w
      let height = frame.sourceSize.h
      let r = 1
      if (sheet.fillCanvas) {
        [x, y, width, height, r] = this.fillSize(frame.sourceSize.w, frame.sourceSize.h, canvas.width, canvas.height)
      }
      if (frame.trimmed) {
        x += frame.spriteSourceSize.x * r
        y += frame.spriteSourceSize.y * r
        width -= frame.spriteSourceSize.x * r
        height -= frame.spriteSourceSize.y * r
      }

      this.log('info', 'drawImage ', frame.frame.x, frame.frame.y,
        frame.frame.w, frame.frame.h,
        x, y,
        width, height)
      this.context.drawImage(this.image,
        frame.frame.x, frame.frame.y,
        frame.frame.w, frame.frame.h,
        x, y,
        width, height)
    }

    // onFrame callback
    if (typeof playhead.onFrame === 'function') {
      playhead.onFrame(playhead.currentFrame)
    }

    return true
  }

  /**
   * Test to see if an element is within the viewport
   * @returns {boolean}
   */
  private inViewport(): boolean {
    return true
  }

  /**
   * Log utility method
   * @param level
   * @param message
   * @private
   */
  private log(level, ...message) {
    if (typeof console === 'undefined' || (level === 'info' && !this.debug)) {
      return
    }
    console[level](`Spriteling`, ...message)
  }
}

export default Spriteling
