// Copyright 2025, Tim Lehmann for whynotmake.it
//
// Alternative liquid glass shader with different normal calculation approach

#version 320 es
precision mediump float;

#define DEBUG_NORMALS 0
#define DEBUG_BLUR_MATTE 0

#include <flutter/runtime_effect.glsl>

// Declare samplers BEFORE including shared.glsl so BACKGROUND_TEXTURE macro can resolve it.
uniform sampler2D uBackgroundTexture;
uniform sampler2D uForegroundTexture;
uniform sampler2D uForegroundBlurredTexture;
#define BACKGROUND_TEXTURE uBackgroundTexture
#include "shared.glsl"

// Optimized uniform layout - grouped into vectors for 50% fewer API calls
layout(location = 0) uniform vec2 uSize;
layout(location = 1) uniform vec2 uForegroundSize;
layout(location = 2) uniform vec4 uGlassColor;
layout(location = 3) uniform vec4 uOpticalProps;
layout(location = 4) uniform vec4 uLightConfig;
layout(location = 5) uniform vec2 uTransformData;
layout(location = 6) uniform vec2 uLightDirection;
layout(location = 7) uniform mat4 uTransform;

float uChromaticAberration = uOpticalProps.y;
float uLightIntensity = uLightConfig.y;
float uAmbientStrength = uLightConfig.z;
float uThickness = uOpticalProps.z;
float uRefractiveIndex = uOpticalProps.x;
vec2 uOffset = uTransformData.xy;
float uSaturation = uLightConfig.w;
float uGaussianBlur = uOpticalProps.w;

layout(location = 0) out vec4 fragColor;


float approximateSDF(float blurredAlpha, float thickness) {
    float normalizedDistance = smoothstep(0.0, 1.0, blurredAlpha);
    return -normalizedDistance * thickness;
}

vec2 findShapeCenter(vec2 currentUV) {
    vec2 texelSize = 2.0 / uForegroundSize;
    vec2 centerSum = vec2(0.0);
    float totalAlpha = 0.0;
    
    // Use 0-based loop indices to satisfy SkSL constant-expression requirement.
    for (int yi = 0; yi <= 20; yi++) {
        int y = yi - 10;
        for (int xi = 0; xi <= 20; xi++) {
            int x = xi - 10;
            vec2 sampleUV = currentUV + vec2(float(x), float(y)) * texelSize;
            if (sampleUV.x >= 0.0 && sampleUV.x <= 1.0 && sampleUV.y >= 0.0 && sampleUV.y <= 1.0) {
                float alpha = texture(uForegroundTexture, sampleUV).a;
                if (alpha > 0.1) {
                    centerSum += sampleUV * alpha;
                    totalAlpha += alpha;
                }
            }
        }
    }
    return totalAlpha > 0.0 ? centerSum / totalAlpha : currentUV;
}

// Gradient helper - uses FOREGROUND_BLURRED_TEXTURE directly to avoid sampler2D param.
vec2 calculateGradient(vec2 uv, vec2 texelSize) {
    vec2 gradient = vec2(0.0);
    float totalWeight = 0.0;
    for (float scale = 1.0; scale <= 4.0; scale *= 2.0) {
        float weight = 1.0 / scale;
        vec2 d = texelSize * scale;
        float tl = texture(uForegroundBlurredTexture, uv - d).a;
        float tm = texture(uForegroundBlurredTexture, uv - vec2(0.0, d.y)).a;
        float tr = texture(uForegroundBlurredTexture, uv + vec2(d.x, -d.y)).a;
        float ml = texture(uForegroundBlurredTexture, uv - vec2(d.x, 0.0)).a;
        float mr = texture(uForegroundBlurredTexture, uv + vec2(d.x, 0.0)).a;
        float bl = texture(uForegroundBlurredTexture, uv + vec2(-d.x, d.y)).a;
        float bm = texture(uForegroundBlurredTexture, uv + vec2(0.0, d.y)).a;
        float br = texture(uForegroundBlurredTexture, uv + d).a;
        float sobelX = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
        float sobelY = (bl + 2.0 * bm + br) - (tl + 2.0 * tm + tr);
        gradient += vec2(sobelX, sobelY) * weight;
        totalWeight += weight;
    }
    return (gradient / totalWeight) * 0.125;
}

vec3 getReconstructedNormal(vec2 p, float thickness) {
    vec2 uv = p / uForegroundSize;
    if (texture(uForegroundTexture, uv).a < 0.01) {
        return vec3(0.0, 0.0, 1.0);
    }
    vec2 shapeCenter = findShapeCenter(uv);
    vec2 centerToPoint = uv - shapeCenter;
    if (length(centerToPoint) < 0.001) {
        return vec3(0.0, 0.0, 1.0);
    }
    vec2 outwardDirection = normalize(centerToPoint);
    float blurredAlpha = texture(uForegroundBlurredTexture, uv).a;
    float edgeDistance = smoothstep(0.0, 1.0, blurredAlpha);
    float normalExponent = 0.2;
    float normalZ = pow(edgeDistance, normalExponent);
    float xyScale = sqrt(max(0.0, 1.0 - normalZ * normalZ));
    return normalize(vec3(outwardDirection * xyScale, normalZ));
}

vec3 getNormal(vec2 p, float thickness) {
    return getReconstructedNormal(p, thickness);
}

void main() {
    vec2 fragCoord = FlutterFragCoord().xy;

    float screenY = computeY(fragCoord.y, uSize);
    vec2 screenUV = vec2(fragCoord.x / uSize.x, screenY);

    vec2 layerLocalCoord = fragCoord - uOffset;
    vec4 transformedCoord = uTransform * vec4(layerLocalCoord, 0.0, 1.0);
    float layerY = computeY(transformedCoord.y, uForegroundSize);
    vec2 layerUV = vec2(transformedCoord.x / uForegroundSize.x, layerY);

    if (layerUV.x < 0.0 || layerUV.x > 1.0 || layerUV.y < 0.0 || layerUV.y > 1.0) {
        fragColor = texture(uBackgroundTexture, screenUV);
        return;
    }

    vec4 foregroundColor = texture(uForegroundTexture, layerUV);
    if (foregroundColor.a < 0.001) {
        fragColor = texture(uBackgroundTexture, screenUV);
        return;
    }
    
    vec4 blurred = texture(uForegroundBlurredTexture, layerUV);
    float sd = approximateSDF(blurred.a, uThickness);
    
#ifdef IMPELLER_TARGET_OPENGLES
    transformedCoord.xy = layerUV * uForegroundSize;
#endif
    vec3 normal = getNormal(transformedCoord.xy, uThickness);
    
    fragColor = renderLiquidGlass(
        screenUV, 
        fragCoord,
        uSize, 
        sd, 
        uThickness, 
        uRefractiveIndex, 
        uChromaticAberration, 
        uGlassColor, 
        uLightDirection, 
        uLightIntensity, 
        uAmbientStrength, 
        normal,
        foregroundColor.a,
        uGaussianBlur,
        uSaturation
    );
    
    #if DEBUG_NORMALS
        fragColor = debugNormals(fragColor, normal, true);
    #endif

    #if DEBUG_BLUR_MATTE
        fragColor = mix(fragColor, blurred, 0.99);
    #endif
}
