<template>
	<div class="home">
		Hello :)
	</div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";

@Component
export default class Home extends Vue {

	public async mounted():Promise<void> {
	}

	public beforeDestroy(): void {}

}
</script>

<style scoped lang="less">
.home {
}
</style>