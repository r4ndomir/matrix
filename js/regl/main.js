import { makeFullScreenQuad, makePipeline } from "./utils.js";

import makeRain from "./rainPass.js";
import makeBloomPass from "./bloomPass.js";
import makePalettePass from "./palettePass.js";
import makeStripePass from "./stripePass.js";
import makeImagePass from "./imagePass.js";
import makeResurrectionPass from "./resurrectionPass.js";
import makeQuiltPass from "./quiltPass.js";

import * as HoloPlayCore from "../../lib/holoplaycore.module.js";

const effects = {
	none: null,
	plain: makePalettePass,
	customStripes: makeStripePass,
	stripes: makeStripePass,
	pride: makeStripePass,
	transPride: makeStripePass,
	trans: makeStripePass,
	image: makeImagePass,
	resurrection: makeResurrectionPass,
	resurrections: makeResurrectionPass,
};

const dimensions = { width: 1, height: 1 };

const loadJS = (src) =>
	new Promise((resolve, reject) => {
		const tag = document.createElement("script");
		tag.onload = resolve;
		tag.onerror = reject;
		tag.src = src;
		document.body.appendChild(tag);
	});

export default async (canvas, config) => {
	await Promise.all([loadJS("lib/regl.js"), loadJS("lib/gl-matrix.js")]);

	const resize = () => {
		canvas.width = Math.ceil(canvas.clientWidth * config.resolution);
		canvas.height = Math.ceil(canvas.clientHeight * config.resolution);
	};
	window.onresize = resize;
	resize();

	const regl = createREGL({
		canvas,
		extensions: ["OES_texture_half_float", "OES_texture_half_float_linear"],
		// These extensions are also needed, but Safari misreports that they are missing
		optionalExtensions: ["EXT_color_buffer_half_float", "WEBGL_color_buffer_float", "OES_standard_derivatives"],
	});

	const lkg = await new Promise((resolve, reject) => {
		const client = new HoloPlayCore.Client((data) => {
			if (data.devices.length === 0) {
				resolve({ tileCount: [1, 1] });
			}

			// TODO: get these from device
			const quiltResolution = 3360;
			const tileCount = [8, 6];

			const defaultCalibration = {
				configVersion: "1.0",
				serial: "00000",
				pitch: 47.556365966796878,
				slope: -5.488804340362549,
				center: 0.15815216302871705,
				viewCone: 40.0,
				invView: 1.0,
				verticalAngle: 0.0,
				DPI: 338.0,
				screenW: 2560.0,
				screenH: 1600.0,
				flipImageX: 0.0,
				flipImageY: 0.0,
				flipSubp: 0.0,
			};

			const calibration = data.devices?.[0]?.calibration ?? defaultCalibration;

			const screenInches = calibration.screenW / calibration.DPI;

			let pitch = calibration.pitch * screenInches;
			pitch *= Math.cos(Math.atan(1.0 / calibration.slope));

			let tilt = calibration.screenH / (calibration.screenW * calibration.slope);
			if (calibration.flipImageX == 1) {
				tilt *= -1;
			}

			const { center, invView, flipImageX, flipImageY, screenW } = calibration;

			resolve({
				pitch,
				tilt,
				center,
				invView,
				flipX: flipImageX,
				flipY: flipImageY,
				subp: 1 / (screenW * 3),
				quiltResolution,
				tileCount,
				quiltViewPortion: [
					(Math.floor(quiltResolution / tileCount[0]) * tileCount[0]) / quiltResolution,
					(Math.floor(quiltResolution / tileCount[1]) * tileCount[1]) / quiltResolution,
				],
			});
		}, reject);
	});

	// All this takes place in a full screen quad.
	const fullScreenQuad = makeFullScreenQuad(regl);
	const effectName = config.effect in effects ? config.effect : "plain";
	const pipeline = makePipeline({ regl, config, lkg }, [makeRain, makeBloomPass, effects[effectName], makeQuiltPass]);
	const screenUniforms = { tex: pipeline[pipeline.length - 1].outputs.primary };
	const drawToScreen = regl({ uniforms: screenUniforms });
	await Promise.all(pipeline.map((step) => step.ready));
	const tick = regl.frame(({ viewportWidth, viewportHeight }) => {
		// tick.cancel();
		if (dimensions.width !== viewportWidth || dimensions.height !== viewportHeight) {
			dimensions.width = viewportWidth;
			dimensions.height = viewportHeight;
			for (const step of pipeline) {
				step.setSize(viewportWidth, viewportHeight);
			}
		}
		fullScreenQuad(() => {
			for (const step of pipeline) {
				step.execute();
			}
			drawToScreen();
		});
	});
};
