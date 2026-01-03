import * as THREE from 'three';

export function createSundial() {
    const group = new THREE.Group();

    // Create base/platform
    const baseGeometry = new THREE.CylinderGeometry(3, 3.2, 0.3, 32);
    const baseMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b7355,
        metalness: 0.3,
        roughness: 0.7
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.receiveShadow = true;
    base.castShadow = true;
    group.add(base);

    // Create clock face
    const faceGeometry = new THREE.CylinderGeometry(2.8, 2.8, 0.1, 64);
    const faceMaterial = new THREE.MeshStandardMaterial({
        color: 0xf5f5dc,
        metalness: 0.1,
        roughness: 0.5
    });
    const face = new THREE.Mesh(faceGeometry, faceMaterial);
    face.position.y = 0.2;
    face.receiveShadow = true;
    face.castShadow = true;
    group.add(face);

    // Add hour markers
    const markerGroup = new THREE.Group();
    for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI) / 6;
        const radius = 2.3;
        
        // Create marker
        const markerGeometry = new THREE.BoxGeometry(0.1, 0.2, 0.05);
        const markerMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        
        marker.position.x = Math.sin(angle) * radius;
        marker.position.z = Math.cos(angle) * radius;
        marker.position.y = 0.25;
        marker.rotation.y = -angle;
        
        markerGroup.add(marker);

        // Add hour numbers
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 64;
        canvas.height = 64;
        context.fillStyle = '#000000';
        context.font = 'bold 48px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText((i === 0 ? 12 : i).toString(), 32, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const numberMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
        const numberGeometry = new THREE.PlaneGeometry(0.3, 0.3);
        const number = new THREE.Mesh(numberGeometry, numberMaterial);
        
        const numRadius = 2.0;
        number.position.x = Math.sin(angle) * numRadius;
        number.position.z = Math.cos(angle) * numRadius;
        number.position.y = 0.26;
        number.rotation.x = -Math.PI / 2;
        
        markerGroup.add(number);
    }
    group.add(markerGroup);

    // Create gnomon (the pointer that casts shadow)
    const gnomonGroup = new THREE.Group();
    
    const gnomonGeometry = new THREE.ConeGeometry(0.1, 2, 8);
    const gnomonMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a4a4a,
        metalness: 0.7,
        roughness: 0.3
    });
    const gnomon = new THREE.Mesh(gnomonGeometry, gnomonMaterial);
    gnomon.castShadow = true;
    gnomon.position.y = 1;
    gnomon.rotation.z = Math.PI / 2;
    gnomonGroup.add(gnomon);

    gnomonGroup.position.y = 0.2;
    group.add(gnomonGroup);

    // Clock hands
    const hourHandGroup = new THREE.Group();
    const minuteHandGroup = new THREE.Group();
    const secondHandGroup = new THREE.Group();

    // Hour hand
    const hourHandGeometry = new THREE.BoxGeometry(0.1, 1.2, 0.05);
    const hourHandMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const hourHand = new THREE.Mesh(hourHandGeometry, hourHandMaterial);
    hourHand.position.y = 0.6;
    hourHand.castShadow = true;
    hourHandGroup.add(hourHand);
    hourHandGroup.position.y = 0.27;
    group.add(hourHandGroup);

    // Minute hand
    const minuteHandGeometry = new THREE.BoxGeometry(0.08, 1.6, 0.05);
    const minuteHandMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const minuteHand = new THREE.Mesh(minuteHandGeometry, minuteHandMaterial);
    minuteHand.position.y = 0.8;
    minuteHand.castShadow = true;
    minuteHandGroup.add(minuteHand);
    minuteHandGroup.position.y = 0.28;
    group.add(minuteHandGroup);

    // Second hand
    const secondHandGeometry = new THREE.BoxGeometry(0.05, 1.8, 0.05);
    const secondHandMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const secondHand = new THREE.Mesh(secondHandGeometry, secondHandMaterial);
    secondHand.position.y = 0.9;
    secondHand.castShadow = true;
    secondHandGroup.add(secondHand);
    secondHandGroup.position.y = 0.29;
    group.add(secondHandGroup);

    // Center dot
    const centerGeometry = new THREE.SphereGeometry(0.1, 16, 16);
    const centerMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const center = new THREE.Mesh(centerGeometry, centerMaterial);
    center.position.y = 0.3;
    group.add(center);

    // Update function to rotate hands
    function update(time) {
        const now = time || new Date();
        const hours = now.getHours() % 12;
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();
        const milliseconds = now.getMilliseconds();

        // Rotate hands (counter-clockwise from top)
        const secondAngle = -((seconds + milliseconds / 1000) / 60) * Math.PI * 2;
        const minuteAngle = -((minutes + seconds / 60) / 60) * Math.PI * 2;
        const hourAngle = -((hours + minutes / 60) / 12) * Math.PI * 2;

        secondHandGroup.rotation.y = secondAngle;
        minuteHandGroup.rotation.y = minuteAngle;
        hourHandGroup.rotation.y = hourAngle;

        // Gentle rotation of entire sundial for visual interest
        group.rotation.y = Math.sin(Date.now() * 0.0001) * 0.1;
    }

    return {
        group,
        update
    };
}
